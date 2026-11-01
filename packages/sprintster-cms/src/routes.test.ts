import { describe, expect, it } from 'vitest';
import { buildCollections } from './collections.js';
import { parseSiteConfig } from './config.js';
import { languageOf, matchRoute, urlFor, urlSpace, type RouteMatch } from './routes.js';
import { blogObjects, blogSite } from './test-objects.js';

const site = parseSiteConfig(blogSite);
const collections = buildCollections(site, blogObjects);
const publicSpace = urlSpace(site, collections);
const previewSpace = urlSpace(site, collections, { preview: true });

// Every URL shape the blog served before collections existed, with what it shows.
const blogUrls: ReadonlyArray<[string, RouteMatch]> = [
  ['/', { kind: 'home' }],
  ['/blog/', { kind: 'list', collection: 'post', page: 1 }],
  ['/blog/page/3/', { kind: 'list', collection: 'post', page: 3 }],
  ['/blog/hello-world/', { kind: 'item', collection: 'post', slug: 'hello-world' }],
  ['/categories/guides/', { kind: 'item', collection: 'category', slug: 'guides' }],
  ['/tags/images/', { kind: 'item', collection: 'tag', slug: 'images' }],
  ['/about/', { kind: 'item', collection: 'page', slug: 'about' }],
];

describe('matchRoute', () => {
  it.each(blogUrls)('keeps the blog URL %s', (path, expected) => {
    expect(matchRoute(path, publicSpace)).toEqual(expected);
  });

  it('accepts a path without a trailing slash', () => {
    expect(matchRoute('/blog/hello-world', publicSpace)).toEqual({ kind: 'item', collection: 'post', slug: 'hello-world' });
  });

  it('refuses a path deeper than a record', () => {
    expect(matchRoute('/about/team', publicSpace)).toBeNull();
    expect(matchRoute('/tags/images/extra', publicSpace)).toBeNull();
  });

  it('refuses a non-positive page number', () => {
    expect(matchRoute('/blog/page/0', publicSpace)).toBeNull();
    expect(matchRoute('/blog/page/two', publicSpace)).toBeNull();
  });

  it('decodes a percent-encoded slug', () => {
    expect(matchRoute('/tags/two%20words', publicSpace)).toEqual({ kind: 'item', collection: 'tag', slug: 'two words' });
  });

  it('matches the root collection last', () => {
    expect(matchRoute('/categories/', publicSpace)).toEqual({ kind: 'list', collection: 'category', page: 1 });
  });

  it('follows a moved collection', () => {
    const moved = parseSiteConfig({ collections: { ...blogSite.collections, post: { path: '/en/articles' } } });
    const space = urlSpace(moved, buildCollections(moved, blogObjects));
    expect(matchRoute('/en/articles/x/', space)).toEqual({ kind: 'item', collection: 'post', slug: 'x' });
    expect(matchRoute('/blog/x/', space)).toBeNull();
  });
});

describe('preview space', () => {
  it('matches only under its prefix', () => {
    expect(matchRoute('/preview/blog/x/', previewSpace)).toEqual({ kind: 'item', collection: 'post', slug: 'x' });
    expect(matchRoute('/blog/x/', previewSpace)).toBeNull();
  });

  it('treats the bare prefix as home', () => {
    expect(matchRoute('/preview', previewSpace)).toEqual({ kind: 'home' });
  });
});

describe('urlFor', () => {
  it.each(blogUrls)('round trips %s', (path, match) => {
    expect(urlFor(match, publicSpace)).toBe(path);
    expect(matchRoute(urlFor(match, publicSpace), publicSpace)).toEqual(match);
  });

  it('keeps a previewed link inside the preview prefix', () => {
    expect(urlFor({ kind: 'item', collection: 'post', slug: 'x' }, previewSpace)).toBe('/preview/blog/x/');
    expect(urlFor({ kind: 'home' }, previewSpace)).toBe('/preview/');
  });
});

describe('languages', () => {
  const locales = ['en', 'hu'];
  const en = urlSpace(site, collections, { locales });
  const hu = urlSpace(site, collections, { locales, lang: 'hu' });

  it('leaves the default language unprefixed and prefixes the others', () => {
    const match: RouteMatch = { kind: 'item', collection: 'post', slug: 'x' };
    expect(urlFor(match, en)).toBe('/blog/x/');
    expect(urlFor(match, hu)).toBe('/hu/blog/x/');
    expect(urlFor({ kind: 'home' }, hu)).toBe('/hu/');
    expect(matchRoute('/hu/blog/x/', hu)).toEqual(match);
    expect(matchRoute('/hu', hu)).toEqual({ kind: 'home' });
    expect(matchRoute('/blog/x/', hu)).toBeNull();
  });

  it('puts the language after the preview prefix', () => {
    const space = urlSpace(site, collections, { locales, lang: 'hu', preview: true });
    expect(urlFor({ kind: 'list', collection: 'post', page: 2 }, space)).toBe('/preview/hu/blog/page/2/');
    expect(matchRoute('/preview/hu/blog/page/2/', space)).toEqual({ kind: 'list', collection: 'post', page: 2 });
  });

  it('reads the language from the path', () => {
    expect(languageOf('/hu/blog/x/', '', locales)).toBe('hu');
    expect(languageOf('/blog/x/', '', locales)).toBe('en');
    expect(languageOf('/preview/hu/', '/preview', locales)).toBe('hu');
    expect(languageOf('/en/x/', '', locales)).toBe('en');
    expect(languageOf('/x/', '', [])).toBeNull();
  });
});
