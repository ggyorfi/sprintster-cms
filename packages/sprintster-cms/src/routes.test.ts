import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config.js';
import { matchRoute, urlFor, urlSpace, type RouteMatch } from './routes.js';

const site = parseSiteConfig({});
const publicSpace = urlSpace(site);
const previewSpace = urlSpace(site, true);

const cases: ReadonlyArray<[string, RouteMatch]> = [
  ['/', { kind: 'home' }],
  ['/blog/', { kind: 'postIndex', page: 1 }],
  ['/blog/page/3/', { kind: 'postIndex', page: 3 }],
  ['/blog/hello-world/', { kind: 'post', slug: 'hello-world' }],
  ['/categories/guides/', { kind: 'category', slug: 'guides' }],
  ['/tags/images/', { kind: 'tag', slug: 'images' }],
  ['/about/', { kind: 'page', slug: 'about' }],
];

describe('matchRoute', () => {
  it.each(cases)('matches %s', (path, expected) => {
    expect(matchRoute(path, publicSpace)).toEqual(expected);
  });

  it('accepts a path without a trailing slash', () => {
    expect(matchRoute('/blog/hello-world', publicSpace)).toEqual({ kind: 'post', slug: 'hello-world' });
  });

  it('refuses a path deeper than its route', () => {
    expect(matchRoute('/about/team', publicSpace)).toBeNull();
    expect(matchRoute('/tags/images/extra', publicSpace)).toBeNull();
  });

  it('refuses a non-positive page number', () => {
    expect(matchRoute('/blog/page/0', publicSpace)).toBeNull();
    expect(matchRoute('/blog/page/two', publicSpace)).toBeNull();
  });

  it('decodes a percent-encoded slug', () => {
    expect(matchRoute('/tags/two%20words', publicSpace)).toEqual({ kind: 'tag', slug: 'two words' });
  });

  it('follows a renamed post route', () => {
    const renamed = urlSpace(parseSiteConfig({ routes: { posts: 'articles' } }));
    expect(matchRoute('/articles/x/', renamed)).toEqual({ kind: 'post', slug: 'x' });
    expect(matchRoute('/blog/x/', renamed)).toBeNull();
  });
});

describe('preview space', () => {
  it('matches only under its prefix', () => {
    expect(matchRoute('/preview/blog/x/', previewSpace)).toEqual({ kind: 'post', slug: 'x' });
    expect(matchRoute('/blog/x/', previewSpace)).toBeNull();
  });

  it('treats the bare prefix as home', () => {
    expect(matchRoute('/preview', previewSpace)).toEqual({ kind: 'home' });
  });
});

describe('urlFor', () => {
  it.each(cases)('round trips %s', (path, match) => {
    expect(urlFor(match, publicSpace)).toBe(path);
    expect(matchRoute(urlFor(match, publicSpace), publicSpace)).toEqual(match);
  });

  it('keeps a previewed link inside the preview prefix', () => {
    expect(urlFor({ kind: 'post', slug: 'x' }, previewSpace)).toBe('/preview/blog/x/');
    expect(urlFor({ kind: 'home' }, previewSpace)).toBe('/preview/');
  });
});
