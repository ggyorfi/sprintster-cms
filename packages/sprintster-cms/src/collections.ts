import type { ObjectConfig } from 'sprintster';
import { prefixesOf, type SiteConfig } from './config.js';

export interface Collection {
  object: string;
  path: string;
  sort: { property: string; descending: boolean } | null;
  perPage: number;
  home: string | null;
  // null: every record is live. Otherwise the fields that decide it, each present only when the object has that property.
  publish: { status: { property: string; value: string } | null; date: string | null } | null;
}

function hasSlug(obj: ObjectConfig): boolean {
  return obj.properties.some((p) => p.name === 'slug' && p.type === 'text');
}

function inside(path: string, parent: string): boolean {
  return parent !== '/' && (path === parent || path.startsWith(`${parent}/`));
}

function fail(message: string): never {
  throw new Error(`scms collections: ${message}. See docs/ADR/0002-collections-and-routes.md`);
}

// An object with a slug is a collection at /<its route>; scms.config.json only overrides.
export function buildCollections(site: SiteConfig, objects: readonly ObjectConfig[], locales: readonly string[] = []): Collection[] {
  const byName = new Map(objects.map((o) => [o.name, o]));
  for (const [name, override] of Object.entries(site.collections)) {
    const obj = byName.get(name);
    if (obj === undefined) fail(`'${name}' is not an object of this app (has: ${[...byName.keys()].join(', ')})`);
    if (override !== false && !hasSlug(obj)) fail(`'${name}' has no text property 'slug', so its records have no URL`);
  }

  const collections: Collection[] = [];
  for (const obj of objects) {
    const override = site.collections[obj.name];
    if (override === false || !hasSlug(obj)) continue;
    const props = new Set(obj.properties.map((p) => p.name));
    const sort = override?.sort;
    const publish = override?.publish;
    const statusValue = publish === false ? undefined : (publish?.status ?? 'published');
    const dateProperty = publish === false ? undefined : (publish?.date ?? 'publishedAt');
    collections.push({
      object: obj.name,
      path: override?.path ?? `/${obj.route}`,
      sort: sort === undefined ? null : { property: sort.replace(/^-/, ''), descending: sort.startsWith('-') },
      perPage: override?.perPage ?? site.pagination.perPage,
      home: override?.home ?? null,
      publish:
        publish === false
          ? null
          : {
              status: props.has('status') && statusValue !== undefined ? { property: 'status', value: statusValue } : null,
              date: dateProperty !== undefined && props.has(dateProperty) ? dateProperty : null,
            },
    });
    if (sort !== undefined && !props.has(sort.replace(/^-/, ''))) {
      fail(`'${obj.name}' sorts by '${sort}', which is not one of its properties`);
    }
  }

  const roots = collections.filter((c) => c.path === '/');
  if (roots.length > 1) fail(`only one collection can be at '/'; ${roots.map((c) => `'${c.object}'`).join(' and ')} both are`);
  for (const c of collections) {
    if (c.home !== null && c.path !== '/') fail(`'${c.object}' sets home but is at '${c.path}'; home belongs to the '/' collection`);
    const first = c.path.split('/')[1];
    if (first !== undefined && locales.slice(1).includes(first)) {
      fail(`'${c.object}' at '${c.path}' starts with the language prefix '/${first}'`);
    }
    for (const prefix of prefixesOf(site.server)) {
      if (inside(c.path, prefix) || inside(prefix, c.path)) fail(`'${c.object}' at '${c.path}' collides with the server prefix '${prefix}'`);
    }
    for (const other of collections) {
      if (other === c || c.path === '/' || other.path === '/') continue;
      if (c.path === other.path) fail(`'${c.object}' and '${other.object}' are both at '${c.path}'`);
      if (inside(c.path, other.path)) {
        fail(`'${c.object}' at '${c.path}' is inside '${other.object}' at '${other.path}', where it would read as a record URL`);
      }
    }
  }
  return collections;
}
