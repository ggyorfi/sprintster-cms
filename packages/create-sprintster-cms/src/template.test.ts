import { describe, it, expect } from 'vitest';
import { buildFiles, cmsObjects } from './template.js';

describe('buildFiles', () => {
  it('emits the expected files', () => {
    const files = buildFiles({ name: 'my-site', backend: 'sqlite' });
    expect(Object.keys(files).sort()).toEqual(
      ['.gitignore', 'README.md', 'package.json', 'pnpm-workspace.yaml', 'sprintster.config.json'].sort(),
    );
  });

  it('produces a JSON config with the six CMS objects', () => {
    const files = buildFiles({ name: 'my-site', backend: 'sqlite' });
    const cfg = JSON.parse(files['sprintster.config.json']!);
    expect(cfg.app.objects.map((o: { name: string }) => o.name)).toEqual([
      'page',
      'post',
      'category',
      'tag',
      'navItem',
      'settings',
    ]);
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
    expect(pkg.scripts).toMatchObject({ build: 'scms build', reset: 'scms reset' });
  });

  it('always approves native builds and only writes overrides when local', () => {
    const published = buildFiles({ name: 's', backend: 'sqlite' })['pnpm-workspace.yaml']!;
    expect(published).toContain('allowBuilds:');
    expect(published).toContain('better-sqlite3: true');
    expect(published).not.toContain('overrides:');

    const local = buildFiles({
      name: 's',
      backend: 'sqlite',
      overrides: { sprintster: 'link:../sprintster/packages/sprintster', 'sprintster-cms': 'link:../sprintster-cms/packages/sprintster-cms' },
    })['pnpm-workspace.yaml']!;
    expect(local).toContain('overrides:');
    expect(local).toContain("sprintster: 'link:../sprintster/packages/sprintster'");
  });

  it('enforces a settings singleton via a hidden unique field', () => {
    const settings = cmsObjects.find((o) => o.name === 'settings')!;
    const singleton = settings.properties.find((p) => p.name === 'singleton')!;
    expect(singleton).toMatchObject({ type: 'text', default: 'site', editable: 'never', validation: { unique: true } });
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
