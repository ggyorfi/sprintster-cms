import { describe, expect, it } from 'vitest';
import { buildCollections } from './collections.js';
import { parseSiteConfig } from './config.js';
import { blogObjects, blogSite, object } from './test-objects.js';

const build = (raw: unknown, objects = blogObjects) => buildCollections(parseSiteConfig(raw), objects);

describe('buildCollections', () => {
  it('makes every object with a slug a collection at its route', () => {
    expect(build({}).map((c) => [c.object, c.path])).toEqual([
      ['page', '/pages'],
      ['post', '/posts'],
      ['category', '/categories'],
      ['tag', '/tags'],
    ]);
  });

  it('applies overrides', () => {
    const [page, post] = build(blogSite);
    expect(page).toMatchObject({ path: '/', home: 'home' });
    expect(post).toMatchObject({ path: '/blog', sort: { property: 'publishedAt', descending: true }, perPage: 10 });
  });

  it('leaves out a collection set to false', () => {
    expect(build({ collections: { tag: false } }).map((c) => c.object)).not.toContain('tag');
  });

  it('publishes by status and publishedAt only where the object has them', () => {
    const [page, , category] = build({});
    expect(page!.publish).toEqual({ status: { property: 'status', value: 'published' }, date: 'publishedAt' });
    expect(category!.publish).toEqual({ status: null, date: null });
    expect(build({ collections: { page: { publish: false } } })[0]!.publish).toBeNull();
  });

  it('rejects an unknown object or one without a slug', () => {
    expect(() => build({ collections: { work: {} } })).toThrow(/'work' is not an object/);
    expect(() => build({ collections: { asset: {} } })).toThrow(/'asset' has no text property 'slug'/);
  });

  it('rejects malformed paths when the file is read', () => {
    for (const path of ['blog', '/blog/', '/Blog', '//x', '']) {
      expect(() => parseSiteConfig({ collections: { post: { path } } })).toThrow(/lowercase segments/);
    }
  });

  it('rejects colliding paths, naming both collections', () => {
    expect(() => build({ collections: { post: { path: '/tags' } } })).toThrow(/'post' and 'tag' are both at '\/tags'/);
    expect(() => build({ collections: { post: { path: '/tags/archive' } } })).toThrow(/'post' at '\/tags\/archive' is inside 'tag'/);
    expect(() => build({ collections: { post: { path: '/' }, page: { path: '/' } } })).toThrow(/only one collection can be at '\/'/);
  });

  it('rejects a path that starts with a language prefix', () => {
    const site = parseSiteConfig({ collections: { post: { path: '/hu/posts' } } });
    expect(() => buildCollections(site, blogObjects, ['en', 'hu'])).toThrow(/language prefix '\/hu'/);
    expect(buildCollections(parseSiteConfig({ collections: { post: { path: '/en/posts' } } }), blogObjects, ['en', 'hu'])).toBeDefined();
  });

  it('rejects a path on a server prefix', () => {
    expect(() => build({ collections: { post: { path: '/admin' } } })).toThrow(/server prefix '\/admin'/);
    expect(() => build({ collections: { post: { path: '/api/posts' } } })).toThrow(/server prefix '\/api'/);
  });

  it('rejects home off the root and a sort by an unknown property', () => {
    expect(() => build({ collections: { post: { home: 'x' } } })).toThrow(/home belongs to the '\/' collection/);
    expect(() => build({ collections: { post: { sort: '-date' } } })).toThrow(/sorts by '-date'/);
  });

  it('points at the replacement when a config still has routes', () => {
    expect(() => parseSiteConfig({ routes: { posts: 'blog' } })).toThrow(/replaced by 'collections'/);
  });

  it('needs no override for a portfolio', () => {
    const work = object('work', 'works', [{ name: 'title', type: 'text' }, { name: 'slug', type: 'text' }]);
    const exhibition = object('exhibition', 'exhibitions', [{ name: 'slug', type: 'text' }]);
    expect(buildCollections(parseSiteConfig({}), [work, exhibition]).map((c) => c.path)).toEqual(['/works', '/exhibitions']);
  });
});
