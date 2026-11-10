import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { filters, type Filters } from './filters.js';
import type { TemplateData } from './viewmodel.js';

export interface Theme {
  // Child first (ADR 4): a file is taken from the first layer that has it.
  dirs: string[];
  has(template: string): boolean;
  render(template: string, data: TemplateData, overrides?: Partial<Filters>): string;
  // Without layout.eta, for a page that must not link to the rest of the site.
  renderAlone(template: string, data: TemplateData, overrides?: Partial<Filters>): string;
}

const BUNDLED = fileURLToPath(new URL('../theme', import.meta.url));

export function resolveThemeDir(name: string, root: string): string {
  if (isAbsolute(name)) {
    if (existsSync(name)) return name;
    throw new Error(`no theme at ${name}`);
  }
  const local = join(root, 'themes', name);
  if (existsSync(local)) return local;
  const bundled = join(BUNDLED, name);
  if (existsSync(bundled)) return bundled;
  throw new Error(`no theme '${name}' in ${join(root, 'themes')} or ${BUNDLED}`);
}

// Filters reach templates as plain calls, so `date(post.date, '%B %e, %Y')` matches Liquid's `date: '%B %e, %Y'` in name and argument order. Liquid's `default` is bound as `fallback`, the one renaming, because `default` cannot be a binding name in JavaScript.
const BINDABLE = Object.keys(filters).filter((name) => name !== 'default');
const FUNCTION_HEADER = `const {${BINDABLE.join(', ')}} = it.filters; const fallback = it.filters.default;`;

// The theme and every theme it extends through `theme.json` (ADR 4), child first.
export function resolveThemeDirs(name: string, root: string): string[] {
  const dirs = [resolveThemeDir(name, root)];
  for (;;) {
    const dir = dirs[dirs.length - 1]!;
    const file = join(dir, 'theme.json');
    if (!existsSync(file)) return dirs;
    const parent = (JSON.parse(readFileSync(file, 'utf8')) as { extends?: unknown }).extends;
    if (parent === undefined) return dirs;
    if (typeof parent !== 'string' || parent === '') throw new Error(`${file}: "extends" must be a theme name or a path`);
    const next = /^\.\.?\//.test(parent) || isAbsolute(parent) ? resolveThemeDir(resolve(dir, parent), root) : resolveThemeDir(parent, root);
    if (dirs.includes(next)) throw new Error(`theme extends itself: ${[...dirs, next].join(' -> ')}`);
    dirs.push(next);
  }
}

const inside = (parent: string, path: string) => {
  const rel = relative(parent, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

// Looks each template up layer by layer; an include is named relative to its layer, so a parent template finds the child's partial.
class LayeredEta extends Eta {
  constructor(private readonly layers: string[], options: ConstructorParameters<typeof Eta>[0]) {
    super(options);
  }

  override resolvePath = (template: string, options?: { filepath?: string }): string => {
    const name = template.endsWith('.eta') ? template : `${template}.eta`;
    const base = options?.filepath;
    const from = base === undefined || name.startsWith('/') ? '' : relative(this.layers.find((l) => inside(l, base)) ?? dirname(base), dirname(base));
    const rel = join(from, name.replace(/^\/+/, ''));
    for (const layer of this.layers) {
      const path = join(layer, rel);
      if (inside(layer, path) && existsSync(path)) return path;
    }
    throw new Error(`no template '${rel}' in ${this.layers.join(', ')}`);
  };
}

export function loadTheme(name: string, root: string, cache = true): Theme {
  const dirs = resolveThemeDirs(name, root);
  const eta = new LayeredEta(dirs, { views: dirs[0]!, cache, functionHeader: FUNCTION_HEADER, autoTrim: false });
  return {
    dirs,
    has: (template) => dirs.some((dir) => existsSync(join(dir, `${template}.eta`))),
    render(template, data, overrides = {}) {
      const withFilters = { ...data, filters: { ...filters, ...overrides } };
      const content = eta.render(template, withFilters);
      return eta.render('layout', { ...withFilters, content });
    },
    renderAlone(template, data, overrides = {}) {
      return eta.render(template, { ...data, filters: { ...filters, ...overrides } });
    },
  };
}
