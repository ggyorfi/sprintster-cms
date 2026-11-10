import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyThemeStatic } from './build.js';
import { loadTheme, resolveThemeDirs } from './theme.js';
import type { TemplateData } from './viewmodel.js';

function files(root: string, tree: Record<string, string>): void {
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function site() {
  const root = mkdtempSync(join(tmpdir(), 'scms-layers-'));
  files(root, {
    'shared/theme/layout.eta': '<main><%~ it.content %></main>',
    'shared/theme/page.eta': 'page:<%~ include("_note") %>|<%~ include("parts/_tail") %>',
    'shared/theme/_note.eta': 'shared note',
    'shared/theme/parts/_tail.eta': 'shared tail',
    'shared/theme/static/site.css': 'shared css',
    'shared/theme/static/brand.css': 'shared brand',
    'site/theme/theme.json': '{ "extends": "../../shared/theme" }',
    'site/theme/_note.eta': 'site note',
    'site/theme/static/brand.css': 'site brand',
    'site/theme/static/logo.svg': 'logo',
  });
  return root;
}

describe('theme layers (ADR 4)', () => {
  it('takes each template and include from the first layer that has it', () => {
    const root = site();
    const theme = loadTheme(join(root, 'site/theme'), root, false);
    expect(theme.dirs).toEqual([join(root, 'site/theme'), join(root, 'shared/theme')]);
    expect(theme.has('page')).toBe(true);
    expect(theme.render('page', {} as TemplateData)).toBe('<main>page:site note|shared tail</main>');
  });

  it('copies static files parent first, so the child wins', async () => {
    const root = site();
    const out = join(root, 'out');
    await copyThemeStatic(resolveThemeDirs(join(root, 'site/theme'), root), out);
    const read = (name: string) => readFileSync(join(out, '_theme', name), 'utf8');
    expect([read('site.css'), read('brand.css'), read('logo.svg')]).toEqual(['shared css', 'site brand', 'logo']);
  });

  it('refuses a theme that extends itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'scms-layers-'));
    files(root, { 'a/theme.json': '{ "extends": "../b" }', 'b/theme.json': '{ "extends": "../a" }' });
    expect(() => resolveThemeDirs(join(root, 'a'), root)).toThrow(/extends itself/);
  });

  it('a theme without theme.json is one layer, as before', () => {
    const root = site();
    expect(resolveThemeDirs(join(root, 'shared/theme'), root)).toEqual([join(root, 'shared/theme')]);
  });
});
