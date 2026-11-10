import { describe, expect, it } from 'vitest';
import { enumerateRoutes, fileFor } from './build.js';
import { buildCollections } from './collections.js';
import { parseSiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import type { Row } from './daemon.js';
import { blogObjects, blogSite } from './test-objects.js';

const site = parseSiteConfig({ ...blogSite, pagination: { perPage: 2 } });
const collections = buildCollections(site, blogObjects);
const rows = (slugs: string[]): Row[] => slugs.map((slug) => ({ id: slug, slug }));
const content = (byObject: Record<string, Row[]>) => ({ rows: new Map(Object.entries(byObject)) }) as unknown as SiteContent;

describe('enumerateRoutes', () => {
  it('lists the home, every list page and every record, the home record only at /', () => {
    const routes = enumerateRoutes(content({ page: rows(['home', 'about']), post: rows(['a', 'b', 'c']), category: [], tag: [] }), collections);
    expect(routes).toEqual([
      { kind: 'home' },
      { kind: 'item', collection: 'page', slug: 'about' },
      { kind: 'list', collection: 'post', page: 1 },
      { kind: 'list', collection: 'post', page: 2 },
      { kind: 'item', collection: 'post', slug: 'a' },
      { kind: 'item', collection: 'post', slug: 'b' },
      { kind: 'item', collection: 'post', slug: 'c' },
      { kind: 'list', collection: 'category', page: 1 },
      { kind: 'list', collection: 'tag', page: 1 },
    ]);
  });

  it('has no home without the home record', () => {
    expect(enumerateRoutes(content({ page: rows(['about']) }), collections)).not.toContainEqual({ kind: 'home' });
  });
});

describe('fileFor', () => {
  it('writes a trailing slash URL as index.html, decoding the slug', () => {
    expect(fileFor('/')).toBe('/index.html');
    expect(fileFor('/hu/blog/page/2/')).toBe('/hu/blog/page/2/index.html');
    expect(fileFor('/tags/two%20words/')).toBe('/tags/two words/index.html');
    expect(fileFor('/api/assets/x')).toBe('/api/assets/x');
  });
});
