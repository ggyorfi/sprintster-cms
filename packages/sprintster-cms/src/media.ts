import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { SiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import type { Daemon } from './daemon.js';
import { fileOf, type ImageSeam } from './images.js';
import {
  createRenditionSeam,
  encodeRendition,
  parseRenditionName,
  renditionContentType,
  sourceFormat,
  type EncodeRequest,
  type SourceProbe,
} from './renditions.js';

export interface ServedRendition {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export interface Media {
  seam(content: SiteContent): Promise<ImageSeam>;
  rendition(name: string): Promise<ServedRendition | null>;
  demanded(): string[];
}

const PROBES_FILE = 'probes.json';
const RENDITIONS_DIR = 'renditions';

// Write then rename, so a reader never sees half a file and a crash leaves no truncated rendition behind.
async function writeAtomic(path: string, bytes: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// The persistent cache outside `dist`. Rendition names are content addressed, so a file that exists is never stale and nothing here is invalidated.
export function createMedia(daemon: Daemon, site: SiteConfig, root: string): Media {
  const dir = resolve(root, site.images.cacheDir);
  const renditionsDir = join(dir, RENDITIONS_DIR);
  const demanded = new Map<string, EncodeRequest>();
  const encoding = new Map<string, Promise<ServedRendition>>();
  let probes: Map<string, SourceProbe> | undefined;

  async function loadProbes(): Promise<Map<string, SourceProbe>> {
    if (probes === undefined) {
      const raw = await readIfExists(join(dir, PROBES_FILE));
      probes = new Map(raw === null ? [] : Object.entries(JSON.parse(raw.toString('utf8')) as Record<string, SourceProbe>));
    }
    return probes;
  }

  async function probe(hash: string, recorded: unknown): Promise<SourceProbe> {
    if (typeof recorded === 'string' && sourceFormat(recorded) === null) return { width: 0, height: 0, format: null };
    const asset = await daemon.asset(hash);
    const format = sourceFormat(typeof recorded === 'string' ? recorded : asset.contentType);
    if (format === null) return { width: 0, height: 0, format: null };
    const { width, height } = (await sharp(asset.bytes).metadata()).autoOrient;
    return { width, height, format };
  }

  async function encode(name: string, request: EncodeRequest): Promise<ServedRendition> {
    const { bytes } = await daemon.asset(request.hash);
    const rendition = await encodeRendition(bytes, request, site.images);
    if (rendition.name !== name) throw new Error(`rendition ${name} encoded as ${rendition.name}`);
    await mkdir(renditionsDir, { recursive: true });
    await writeAtomic(join(renditionsDir, name), rendition.bytes);
    return { bytes: rendition.bytes, contentType: renditionContentType(name) as string };
  }

  return {
    async seam(content) {
      const known = await loadProbes();
      const missing = new Map<string, unknown>();
      for (const asset of content.assets) {
        const file = fileOf(asset);
        const hash = file?.['hash'];
        if (typeof hash === 'string' && !known.has(hash)) missing.set(hash, file?.['contentType']);
      }
      if (missing.size > 0) {
        const measured = await Promise.all([...missing].map(async ([hash, type]) => [hash, await probe(hash, type)] as const));
        for (const [hash, p] of measured) known.set(hash, p);
        await mkdir(dir, { recursive: true });
        await writeAtomic(join(dir, PROBES_FILE), JSON.stringify(Object.fromEntries(known), null, 2));
      }
      return createRenditionSeam(content, site, (hash) => known.get(hash), (name, request) => demanded.set(name, request));
    },

    demanded: () => [...demanded.keys()],

    async rendition(name) {
      const contentType = renditionContentType(name);
      if (contentType === undefined || parseRenditionName(name) === null) return null;
      const cached = await readIfExists(join(renditionsDir, name));
      if (cached !== null) return { bytes: new Uint8Array(cached), contentType };
      const request = demanded.get(name);
      if (request === undefined) return null;
      let pending = encoding.get(name);
      if (pending === undefined) {
        pending = encode(name, request).finally(() => encoding.delete(name));
        encoding.set(name, pending);
      }
      return pending;
    },
  };
}
