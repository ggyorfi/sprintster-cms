import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { filters, type Filters } from './filters.js';
import type { TemplateData } from './viewmodel.js';

export interface Theme {
  dir: string;
  has(template: string): boolean;
  render(template: string, data: TemplateData, overrides?: Partial<Filters>): string;
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

export function loadTheme(name: string, root: string, cache = true): Theme {
  const dir = resolveThemeDir(name, root);
  const eta = new Eta({ views: dir, cache, functionHeader: FUNCTION_HEADER, autoTrim: false });
  return {
    dir,
    has: (template) => existsSync(join(dir, `${template}.eta`)),
    render(template, data, overrides = {}) {
      const withFilters = { ...data, filters: { ...filters, ...overrides } };
      const content = eta.render(template, withFilters);
      return eta.render('layout', { ...withFilters, content });
    },
  };
}
