import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCMS_CONFIG_FILE, loadSiteConfig, parseSiteConfig } from './config.js';

function projectDir(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'scms-config-'));
  if (config !== undefined) writeFileSync(join(dir, SCMS_CONFIG_FILE), config);
  return dir;
}

describe('parseSiteConfig', () => {
  it('fills every default from an empty object', () => {
    expect(parseSiteConfig({})).toEqual({
      configVersion: '1',
      outDir: 'dist',
      theme: 'default',
      langs: ['en'],
      defaultLang: 'en',
      routes: { posts: 'blog', categories: 'categories', tags: 'tags', homeSlug: 'home' },
      images: { widths: [480, 768, 1200, 1920], formats: ['avif', 'webp'], quality: 75, cacheDir: '.scms/cache' },
      pagination: { perPage: 10 },
      server: { port: 4000, admin: '/admin', api: '/api', assets: '/assets', preview: '/preview' },
    });
  });

  it('rejects a server prefix that is not a single leading-slash segment', () => {
    expect(() => parseSiteConfig({ server: { admin: 'admin' } })).toThrow(/segment/);
    expect(() => parseSiteConfig({ server: { admin: '/admin/deep' } })).toThrow(/segment/);
  });

  it('rejects two server prefixes that are the same', () => {
    expect(() => parseSiteConfig({ server: { admin: '/api' } })).toThrow(/must differ/);
  });

  it('rejects a site route that collides with a server prefix', () => {
    expect(() => parseSiteConfig({ routes: { posts: 'admin' } })).toThrow(/collide/);
  });

  it('keeps sibling defaults when a nested key is overridden', () => {
    const config = parseSiteConfig({ routes: { posts: 'articles' } });
    expect(config.routes).toEqual({
      posts: 'articles',
      categories: 'categories',
      tags: 'tags',
      homeSlug: 'home',
    });
  });

  it('rejects an unknown key by name', () => {
    expect(() => parseSiteConfig({ outdir: 'build' })).toThrow(/outdir/);
  });

  it('rejects an empty image width list', () => {
    expect(() => parseSiteConfig({ images: { widths: [] } })).toThrow(/widths/);
  });

  it('rejects an unsupported image format', () => {
    expect(() => parseSiteConfig({ images: { formats: ['gif'] } })).toThrow(/formats/);
  });

  it('defaults defaultLang to the first declared language', () => {
    expect(parseSiteConfig({ langs: ['fr', 'en'] }).defaultLang).toBe('fr');
  });

  it('keeps an explicit defaultLang', () => {
    expect(parseSiteConfig({ langs: ['fr', 'en'], defaultLang: 'en' }).defaultLang).toBe('en');
  });

  it('rejects a defaultLang outside langs', () => {
    expect(() => parseSiteConfig({ langs: ['fr'], defaultLang: 'de' })).toThrow(/defaultLang/);
  });

  it('rejects an empty language list', () => {
    expect(() => parseSiteConfig({ langs: [] })).toThrow(/langs/);
  });
});

describe('loadSiteConfig', () => {
  it('returns defaults when the file is absent', () => {
    expect(loadSiteConfig(projectDir()).outDir).toBe('dist');
  });

  it('reads and validates the file when present', () => {
    const dir = projectDir(JSON.stringify({ outDir: '_site', pagination: { perPage: 25 } }));
    const config = loadSiteConfig(dir);
    expect(config.outDir).toBe('_site');
    expect(config.pagination.perPage).toBe(25);
    expect(config.images.quality).toBe(75);
  });

  it('throws on malformed JSON rather than falling back to defaults', () => {
    expect(() => loadSiteConfig(projectDir('{ not json'))).toThrow();
  });
});
