import { describe, it, expect } from 'vitest';
import { buildFiles, cmsObjects } from './template.js';

describe('buildFiles', () => {
  it('emits the expected files', () => {
    const files = buildFiles({ name: 'my-site', backend: 'sqlite' });
    expect(Object.keys(files).sort()).toEqual(
      ['.gitignore', 'README.md', 'package.json', 'pnpm-workspace.yaml', 'scms.config.json', 'sprintster.config.json'].sort(),
    );
  });

  it('puts pages at the root with home at / and posts under /blog', () => {
    const files = buildFiles({ name: 'my-site', backend: 'sqlite' });
    expect(JSON.parse(files['scms.config.json']!)).toEqual({
      collections: { page: { path: '/', home: 'home' }, post: { path: '/blog', sort: '-publishedAt' } },
    });
  });

  it('produces a JSON config with the six CMS objects', () => {
    const files = buildFiles({ name: 'my-site', backend: 'sqlite' });
    const cfg = JSON.parse(files['sprintster.config.json']!);
    expect(cfg.app.objects.map((o: { name: string }) => o.name)).toEqual([
      'page',
      'post',
      'category',
      'tag',
      'asset',
      'navItem',
      'settings',
    ]);
  });

  it('wires in-body images to the asset object', () => {
    const cfg = JSON.parse(buildFiles({ name: 'my-site', backend: 'sqlite' })['sprintster.config.json']!);
    expect(cfg.app.assets).toBe('asset');
    expect(cfg.app.title).toBe('my-site');

    const asset = cmsObjects.find((o) => o.name === 'asset')!;
    const images = asset.properties.filter((p) => p.type === 'image');
    expect(images.map((p) => p.name)).toEqual(['file']);
    expect(asset.titlePlural).not.toMatch(/^assets$/i);

    const optional = asset.properties.filter((p) => p.name !== 'file' && p.name !== 'id' && p.name !== 'removed');
    for (const prop of optional) expect(prop.validation?.['required']).toBeUndefined();

    for (const name of ['page', 'post']) {
      const body = cmsObjects.find((o) => o.name === name)!.properties.find((p) => p.name === 'body')!;
      expect(body).toMatchObject({ type: 'markdown', images: true });
    }
  });

  it('declares an explicit route on every object, independent of its labels', () => {
    const routes = cmsObjects.map((o) => o.route);
    expect(routes).toEqual(['pages', 'posts', 'categories', 'tags', 'media', 'menu', 'settings']);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) {
      expect(route).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['health', 'config', 'assets']).not.toContain(route);
    }
  });

  it('references assets rather than embedding image values', () => {
    const refs = cmsObjects
      .flatMap((o) => o.properties)
      .filter((p) => ['cover', 'ogImage', 'defaultOgImage'].includes(p.name));
    expect(refs.length).toBe(3);
    for (const prop of refs) expect(prop).toMatchObject({ type: 'ref', target: 'asset' });
  });

  it('adds a prod environment only for postgres', () => {
    const sqlite = JSON.parse(buildFiles({ name: 's', backend: 'sqlite' })['sprintster.config.json']!);
    const postgres = JSON.parse(buildFiles({ name: 's', backend: 'postgres' })['sprintster.config.json']!);
    expect(Object.keys(sqlite.environments)).toEqual(['dev']);
    expect(Object.keys(postgres.environments)).toEqual(['dev', 'prod']);
  });

  it('declares both packages as plain latest deps with a pinned toolchain', () => {
    const pkg = JSON.parse(buildFiles({ name: 's', backend: 'sqlite' })['package.json']!);
    expect(pkg.dependencies).toEqual({ sprintster: 'latest', 'sprintster-cms': 'latest' });
    expect(pkg.packageManager).toBe('pnpm@11.9.0');
    expect(pkg.scripts).toMatchObject({ dev: 'scms dev', serve: 'scms serve', build: 'scms build', reset: 'scms reset' });
  });

  it('always approves native builds and only writes overrides when local', () => {
    const published = buildFiles({ name: 's', backend: 'sqlite' })['pnpm-workspace.yaml']!;
    expect(published).toContain('allowBuilds:');
    expect(published).toContain('better-sqlite3: true');
    expect(published).toContain('sharp: false');
    expect(published).not.toContain('overrides:');

    const local = buildFiles({
      name: 's',
      backend: 'sqlite',
      overrides: { sprintster: 'link:../sprintster/packages/sprintster', 'sprintster-cms': 'link:../sprintster-cms/packages/sprintster-cms' },
    })['pnpm-workspace.yaml']!;
    expect(local).toContain('overrides:');
    expect(local).toContain("sprintster: 'link:../sprintster/packages/sprintster'");
  });

  it('declares settings as a singleton with no lifecycle or list', () => {
    const settings = cmsObjects.find((o) => o.name === 'settings')!;
    expect(settings.singleton).toBe(true);
    expect(settings.lifecycle).toBeUndefined();
    expect(settings.lists).toEqual([]);
    expect(settings.views.length).toBeGreaterThan(0);
    expect(settings.properties.map((p) => p.name)).not.toContain('removed');
  });

  it('marks every slug unique and case-insensitive', () => {
    const slugs = cmsObjects
      .flatMap((o) => o.properties)
      .filter((p) => p.name === 'slug');
    expect(slugs.length).toBe(4);
    for (const slug of slugs) {
      expect(slug.validation).toMatchObject({ unique: true, caseInsensitive: true });
    }
  });
});
