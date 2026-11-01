import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ObjectConfig } from 'sprintster';
import { buildCollections } from './collections.js';
import { parseSiteConfig } from './config.js';
import { loadContent, resolve } from './content.js';
import type { Daemon, Row } from './daemon.js';
import { createRenderer } from './render.js';
import { matchRoute, urlSpace } from './routes.js';
import { loadTheme, type Theme } from './theme.js';
import { createViews } from './viewmodel.js';
import { blogObjects, blogSite, object } from './test-objects.js';

function fakeDaemon(objects: ObjectConfig[], rows: Record<string, Row[]>, locales: string[] = [], assetsObject?: string): Daemon {
  return {
    baseUrl: 'http://daemon',
    objects,
    locales,
    ...(assetsObject === undefined ? {} : { assetsObject }),
    object: (name) => objects.find((o) => o.name === name)!,
    rows: async (name) => rows[name] ?? [],
    asset: async () => ({ bytes: new Uint8Array(), contentType: 'image/png' }),
  };
}

const now = new Date('2026-06-01T00:00:00Z');
const post = (slug: string, extra: Partial<Row> = {}): Row => ({
  id: `p-${slug}`,
  title: slug,
  slug,
  body: `# ${slug}`,
  status: 'published',
  publishedAt: '2026-01-01T00:00:00Z',
  category: 'c1',
  tags: [],
  ...extra,
});

const blogRows: Record<string, Row[]> = {
  page: [{ id: 'home', title: 'Home', slug: 'home', body: 'Welcome', status: 'published' }],
  post: [
    post('old', { publishedAt: '2025-01-01T00:00:00Z' }),
    post('new', { publishedAt: '2026-05-01T00:00:00Z' }),
    post('draft', { status: 'draft' }),
    post('future', { publishedAt: '2027-01-01T00:00:00Z' }),
    post('gone', { removed: true }),
  ],
  category: [{ id: 'c1', name: 'Guides', slug: 'guides' }],
  tag: [],
  navItem: [],
  settings: [{ id: 'settings', siteTitle: 'Harbour' }],
};

async function blog(preview = false) {
  const site = parseSiteConfig(blogSite);
  const collections = buildCollections(site, blogObjects);
  const content = await loadContent(fakeDaemon(blogObjects, blogRows), collections, { preview, now });
  const space = urlSpace(site, collections, { preview });
  return { site, content, space };
}

const theme = (): Theme => loadTheme('default', mkdtempSync(join(tmpdir(), 'scms-theme-')), false);

describe('publishing', () => {
  it('hides drafts, future and removed records, newest first', async () => {
    const { content } = await blog();
    expect(content.rows.get('post')!.map((r) => r['slug'])).toEqual(['new', 'old']);
  });

  it('shows drafts and future records under preview, never removed ones', async () => {
    const { content } = await blog(true);
    expect(content.rows.get('post')!.map((r) => r['slug']).sort()).toEqual(['draft', 'future', 'new', 'old']);
  });
});

describe('rendering', () => {
  async function render(path: string, preview = false) {
    const { site, content, space } = await blog(preview);
    const match = matchRoute(path, space);
    const resolved = match === null ? null : resolve(match, content);
    const renderer = createRenderer(theme(), site, content, space, { now });
    return resolved === null ? null : renderer.page(resolved);
  }

  it('renders the home record at /', async () => {
    expect(await render('/')).toContain('Welcome');
  });

  it('renders a post with its category link', async () => {
    const html = (await render('/blog/new/'))!;
    expect(html).toContain('<h1>new</h1>');
    expect(html).toContain('href="/categories/guides/"');
    expect(html).toContain('<title>new | Harbour</title>');
  });

  it("lists a category's posts through the refs pointing at it", async () => {
    const html = (await render('/categories/guides/'))!;
    expect(html).toContain('href="/blog/new/"');
    expect(html).toContain('href="/blog/old/"');
    expect(html).not.toContain('/blog/draft/');
  });

  it('falls back to the generic list template', async () => {
    expect(await render('/categories/')).toContain('href="/categories/guides/"');
  });

  it('serves no draft outside preview', async () => {
    expect(await render('/blog/draft/')).toBeNull();
    expect(await render('/preview/blog/draft/', true)).toContain('<h1>draft</h1>');
  });

  it('has no list page for the root collection', async () => {
    expect(await render('/page/2/')).toBeNull();
  });
});

describe('record views', () => {
  it('resolves translations to the default locale and names the referring records', async () => {
    const objects = [
      object('work', 'works', [{ name: 'title', type: 'text', translated: true }, { name: 'slug', type: 'text' }, { name: 'exhibitions', type: 'refs', target: 'exhibition' }]),
      object('exhibition', 'exhibitions', [{ name: 'title', type: 'text', translated: true }, { name: 'slug', type: 'text' }]),
    ];
    const rows = {
      work: [{ id: 'w1', title: { en: 'Mask', hu: 'Maszk' }, slug: 'mask', exhibitions: ['e1'] }],
      exhibition: [{ id: 'e1', title: { hu: 'Csak magyar' }, slug: 'show' }],
    };
    const site = parseSiteConfig({});
    const collections = buildCollections(site, objects);
    const content = await loadContent(fakeDaemon(objects, rows, ['en', 'hu']), collections, { now });
    const views = createViews({ content, space: urlSpace(site, collections), images: () => null, renderMarkdown: (s) => s });
    const exhibition = views.full('exhibition', rows.exhibition[0]!);
    expect(exhibition.title).toBeNull();
    expect(exhibition.referencedBy!['work']!.map((w) => [w.title, w.url])).toEqual([['Mask', '/works/mask/']]);
    expect(views.full('work', rows.work[0]!)['exhibitions']).toEqual([expect.objectContaining({ slug: 'show', url: '/exhibitions/show/' })]);
  });
});

describe('languages', () => {
  const objects = [
    object('work', 'works', [{ name: 'title', type: 'text', translated: true }, { name: 'slug', type: 'text' }, { name: 'body', type: 'markdown', translated: true }]),
  ];
  const rows = {
    work: [
      { id: 'w1', title: { en: 'Mask', hu: 'Maszk' }, slug: 'mask', body: { en: 'English text' } },
      { id: 'w2', title: { en: 'Gold' }, slug: 'gold', body: {} },
    ],
  };

  async function render(path: string) {
    const site = parseSiteConfig({});
    const locales = ['en', 'hu'];
    const collections = buildCollections(site, objects, locales);
    const content = await loadContent(fakeDaemon(objects, rows, locales), collections, { now });
    const { languageOf } = await import('./routes.js');
    const lang = languageOf(path, '', locales) ?? undefined;
    const space = urlSpace(site, collections, { locales, ...(lang === undefined ? {} : { lang }) });
    const match = matchRoute(path, space);
    const resolved = match === null ? null : resolve(match, content);
    return resolved === null ? null : createRenderer(theme(), site, content, space, { now }).page(resolved);
  }

  it('renders the page language, falling back to the default per field', async () => {
    const html = (await render('/hu/works/mask/'))!;
    expect(html).toContain('<html lang="hu">');
    expect(html).toContain('<h1>Maszk</h1>');
    expect(html).toContain('English text');
    expect(html).not.toContain('[object Object]');
  });

  it('keeps links in the page language and lists every language as an alternate', async () => {
    const html = (await render('/hu/works/'))!;
    expect(html).toContain('href="/hu/works/mask/"');
    expect(html).toContain('href="/hu/works/gold/"');
    expect(html).toContain('<link rel="alternate" hreflang="en" href="/works/">');
    expect(html).toContain('<link rel="alternate" hreflang="hu" href="/hu/works/">');
  });

  it('serves the default language without a prefix', async () => {
    const html = (await render('/works/mask/'))!;
    expect(html).toContain('<h1>Mask</h1>');
    expect(html).toContain('<html lang="en">');
  });
});

describe('rendition demand', () => {
  it('demands renditions only for images a template reads', async () => {
    const objects = [
      object('asset', 'media', [{ name: 'file', type: 'image' }]),
      object('work', 'works', [{ name: 'title', type: 'text' }, { name: 'slug', type: 'text' }, { name: 'images', type: 'refs', target: 'asset' }]),
    ];
    const rows = { asset: [{ id: 'a1' }], work: [{ id: 'w1', title: 'Mask', slug: 'mask', images: ['a1'] }] };
    const site = parseSiteConfig({});
    const collections = buildCollections(site, objects);
    const content = await loadContent(fakeDaemon(objects, rows, [], 'asset'), collections, { now });
    const asked: string[] = [];
    const views = createViews({ content, space: urlSpace(site, collections), images: (r) => (asked.push(r.assetId), null), renderMarkdown: (s) => s });
    const work = views.full('work', rows.work[0]!);
    void views.data();
    expect(work.title).toBe('Mask');
    expect(asked).toEqual([]);
    void work['images'];
    expect(asked).toEqual(['a1']);
  });
});

describe('theme hooks', () => {
  it('prefers a template named after the record, and lets templates rewrite raw markdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scms-theme-'));
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, 'themes', 'mini'), { recursive: true });
    const file = (name: string, body: string) => writeFileSync(join(root, 'themes', 'mini', `${name}.eta`), body);
    file('layout', '<%~ it.content %>');
    file('item', 'generic');
    file('page-about', '<%~ markdownify(it.page.$raw.body.replace("X", "**Y**")) %>');
    file('404', 'missing');
    const site = parseSiteConfig({ collections: { page: { path: '/' }, post: { list: false } } });
    const collections = buildCollections(site, blogObjects);
    const rows = { ...blogRows, page: [{ id: 'p1', title: 'About', slug: 'about', body: 'X', status: 'published' }, { id: 'p2', title: 'Other', slug: 'other', body: 'X', status: 'published' }] };
    const content = await loadContent(fakeDaemon(blogObjects, rows), collections, { now });
    const space = urlSpace(site, collections);
    const renderer = createRenderer(loadTheme('mini', root, false), site, content, space, { now });
    const page = (path: string) => {
      const match = matchRoute(path, space);
      const resolved = match === null ? null : resolve(match, content);
      return resolved === null ? null : renderer.page(resolved);
    };
    expect(page('/about/')).toContain('<strong>Y</strong>');
    expect(page('/other/')).toBe('generic');
    expect(page('/posts/')).toBeNull();
    expect(page('/posts/new/')).toBe('generic');
  });

  it('carries the asset record on a resolved picture', async () => {
    const objects = [
      object('asset', 'media', [{ name: 'file', type: 'image' }, { name: 'video', type: 'text' }]),
      object('work', 'works', [{ name: 'slug', type: 'text' }, { name: 'images', type: 'refs', target: 'asset' }]),
    ];
    const rows = { asset: [{ id: 'a1', video: 'https://v' }], work: [{ id: 'w1', slug: 'w', images: ['a1'] }] };
    const site = parseSiteConfig({});
    const collections = buildCollections(site, objects);
    const content = await loadContent(fakeDaemon(objects, rows, [], 'asset'), collections, { now });
    const views = createViews({ content, space: urlSpace(site, collections), images: () => ({ src: '/x', alt: '' }), renderMarkdown: (s) => s });
    expect((views.full('work', rows.work[0]!)['images'] as Array<{ record: { video: string } }>)[0]!.record.video).toBe('https://v');
  });
});
