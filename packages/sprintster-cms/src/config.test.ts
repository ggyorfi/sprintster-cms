import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCMS_CONFIG_FILE, loadSiteConfig, parseSiteConfig } from './config.js';
import { resolveThemeDir } from './theme.js';

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
      collections: {},
      private: [],
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

  it('keeps sibling defaults when a nested key is overridden', () => {
    const config = parseSiteConfig({ server: { port: 5000 } });
    expect(config.server).toEqual({ port: 5000, admin: '/admin', api: '/api', assets: '/assets', preview: '/preview' });
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

  it('points at app locales when a config still sets langs', () => {
    expect(() => parseSiteConfig({ langs: ['en', 'hu'] })).toThrow(/moved to the app config as "locales"/);
    expect(() => parseSiteConfig({ defaultLang: 'en' })).toThrow(/locales/);
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

  it('follows extends, with a theme path relative to the file that declares it', () => {
    const root = mkdtempSync(join(tmpdir(), 'scms-extends-'));
    mkdirSync(join(root, 'shared/themes/portfolio'), { recursive: true });
    mkdirSync(join(root, 'site'));
    const shared = { theme: './themes/portfolio', outDir: 'out', collections: { work: { path: '/work' } } };
    writeFileSync(join(root, 'shared', SCMS_CONFIG_FILE), JSON.stringify(shared));
    const site = { extends: '../shared/scms.config.json', collections: { work: { sort: '-date' } } };
    writeFileSync(join(root, 'site', SCMS_CONFIG_FILE), JSON.stringify(site));
    const config = loadSiteConfig(join(root, 'site'));
    expect(config.outDir).toBe('out');
    expect(config.collections['work']).toMatchObject({ path: '/work', sort: '-date' });
    expect(resolveThemeDir(config.theme, join(root, 'site'))).toBe(join(root, 'shared/themes/portfolio'));
  });
});
