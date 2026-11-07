import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { buildCollections, type Collection } from './collections.js';
import { loadSiteConfig } from './config.js';
import { loadContent, resolve, slugOf, type SiteContent } from './content.js';
import { connectDaemon, withoutPrivate } from './daemon.js';
import { fileOf, type ImageSeam } from './images.js';
import { createMedia } from './media.js';
import { createRenderer } from './render.js';
import { urlFor, urlSpace, type RouteMatch, type UrlSpace } from './routes.js';
import { loadTheme } from './theme.js';

export interface BuildOptions {
  root?: string;
  env?: string;
  outDir?: string;
  // Build from this app instead of the local environment's daemon.
  app?: string;
  headers?: Record<string, string>;
}

export interface BuildReport {
  outDir: string;
  pages: number;
  renditions: number;
  originals: number;
}

const CONCURRENCY = 4;

// Every URL the site serves in one language: the home record, each list page, each live record.
export function enumerateRoutes(content: SiteContent, collections: readonly Collection[]): RouteMatch[] {
  const matches: RouteMatch[] = [];
  const root = collections.find((c) => c.path === '/' && c.home !== null);
  if (root !== undefined && (content.rows.get(root.object) ?? []).some((r) => slugOf(r) === root.home)) matches.push({ kind: 'home' });
  for (const c of collections) {
    const rows = content.rows.get(c.object) ?? [];
    if (c.path !== '/' && c.list) {
      const pages = Math.max(1, Math.ceil(rows.length / c.perPage));
      for (let page = 1; page <= pages; page++) matches.push({ kind: 'list', collection: c.object, page });
    }
    for (const r of rows) if (slugOf(r) !== '') matches.push({ kind: 'item', collection: c.object, slug: String(r['slug']) });
  }
  return matches;
}

// A trailing slash URL is a directory with an index.html, so any static host serves it without rewrites.
export function fileFor(url: string): string {
  const path = url.split('/').map((s) => decodeURIComponent(s)).join('/');
  return path.endsWith('/') ? `${path}index.html` : path;
}

async function write(outDir: string, path: string, bytes: string | Uint8Array): Promise<void> {
  const file = join(outDir, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function inBatches<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(run));
}

export async function build(opts: BuildOptions = {}): Promise<BuildReport> {
  const root = opts.root ?? process.cwd();
  const site = loadSiteConfig(root);
  const outDir = resolvePath(root, opts.outDir ?? site.outDir);
  const headers = opts.headers ?? {};
  const withHeaders: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  const daemon = withoutPrivate(
    await connectDaemon({
      root,
      fetch: withHeaders,
      ...(opts.env === undefined ? {} : { env: opts.env }),
      ...(opts.app === undefined ? {} : { baseUrl: opts.app.replace(/\/$/, '') }),
    }),
    site.private,
  );
  const collections = buildCollections(site, daemon.objects, daemon.locales);
  const theme = loadTheme(site.theme, root);
  const media = createMedia(daemon, site, root);
  const content = await loadContent(daemon, collections);
  const seam = await media.seam(content);

  // Images a rendition cannot be made from fall back to the original under the API prefix, so the original is copied there.
  const originalPrefix = `${site.server.api}${site.server.assets}/`;
  const originals = new Set<string>();
  const images: ImageSeam = (request) => {
    const image = seam(request);
    if (image !== null && image.src.startsWith(originalPrefix)) originals.add(request.assetId);
    return image;
  };

  await rm(outDir, { recursive: true, force: true });
  const languages = daemon.locales.length === 0 ? [undefined] : daemon.locales;
  const matches = enumerateRoutes(content, collections);
  let pages = 0;
  let defaultSpace: UrlSpace | undefined;
  for (const lang of languages) {
    const space = urlSpace(site, collections, { locales: daemon.locales, ...(lang === undefined ? {} : { lang }) });
    defaultSpace ??= space;
    const renderer = createRenderer(theme, site, content, space, { images });
    for (const match of matches) {
      const resolved = resolve(match, content);
      if (resolved === null) continue;
      await write(outDir, fileFor(urlFor(match, space)), renderer.page(resolved));
      pages++;
    }
  }
  await write(outDir, '404.html', createRenderer(theme, site, content, defaultSpace!, { images }).notFound());

  const names = media.demanded();
  await inBatches(names, async (name) => {
    const rendition = await media.rendition(name);
    if (rendition === null) throw new Error(`rendition ${name} was demanded but could not be produced`);
    await write(outDir, `${site.server.assets}/${name}`, rendition.bytes);
  });
  await inBatches([...originals], async (id) => {
    const asset = content.assetsById.get(id);
    const hash = asset === undefined ? undefined : fileOf(asset)?.['hash'];
    if (typeof hash !== 'string') return;
    await write(outDir, `${originalPrefix}${id}`, (await daemon.asset(hash)).bytes);
  });

  const staticDir = join(theme.dir, 'static');
  if (existsSync(staticDir)) await cp(staticDir, join(outDir, '_theme'), { recursive: true });
  return { outDir, pages, renditions: names.length, originals: originals.size };
}
