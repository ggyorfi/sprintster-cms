import type { ObjectConfig } from 'sprintster';
import type { Collection } from './collections.js';
import type { Daemon, Row } from './daemon.js';
import type { RouteMatch } from './routes.js';

export interface SiteContent {
  objects: readonly ObjectConfig[];
  collections: readonly Collection[];
  // Live records of every object, in each collection's sort order.
  rows: ReadonlyMap<string, Row[]>;
  locales: readonly string[];
  title: string | null;
  assetsObject: string | null;
  assets: Row[];
  assetsById: Map<string, Row>;
}

export interface LoadOptions {
  preview?: boolean;
  now?: Date;
}

export function slugOf(row: Row): string {
  const slug = row['slug'];
  return typeof slug === 'string' ? slug.toLowerCase() : '';
}

// A translated value is a map of locale to text; anything else is already the value.
export function inLocale(value: unknown, locales: readonly string[], locale?: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || locales.length === 0) return value;
  const map = value as Record<string, unknown>;
  if (!Object.keys(map).every((k) => locales.includes(k))) return value;
  for (const l of [locale, locales[0]]) {
    const text = l === undefined ? undefined : map[l];
    if (typeof text === 'string' && text !== '') return text;
  }
  return null;
}

type Rule = Collection['publish'];

// Objects that are not collections follow the same convention, so a draft menu item stays hidden too.
function conventionRule(obj: ObjectConfig): Rule {
  const props = new Set(obj.properties.map((p) => p.name));
  return {
    status: props.has('status') ? { property: 'status', value: 'published' } : null,
    date: props.has('publishedAt') ? 'publishedAt' : null,
  };
}

// Drafts and future dated records exist but are not published: preview shows them, the site does not.
function isLive(row: Row, rule: Rule, now: number, preview: boolean): boolean {
  if (row['removed'] === true) return false;
  if (preview || rule === null) return true;
  if (rule.status !== null && row[rule.status.property] !== rule.status.value) return false;
  const at = rule.date === null ? undefined : row[rule.date];
  return !(typeof at === 'string' && Date.parse(at) > now);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function sorted(rows: Row[], c: Collection | undefined, locales: readonly string[]): Row[] {
  const sort = c?.sort;
  if (sort === undefined || sort === null) return rows;
  const key = (r: Row) => inLocale(r[sort.property], locales);
  // Missing values sort last in both directions.
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    const empty = (v: unknown) => v === null || v === undefined || v === '';
    if (empty(x) || empty(y)) return compare(x, y);
    return sort.descending ? compare(y, x) : compare(x, y);
  });
}

export async function loadContent(daemon: Daemon, collections: readonly Collection[], opts: LoadOptions = {}): Promise<SiteContent> {
  const preview = opts.preview ?? false;
  const now = (opts.now ?? new Date()).getTime();
  const byObject = new Map(collections.map((c) => [c.object, c]));
  const fetched = await Promise.all(daemon.objects.map(async (obj) => [obj, await daemon.rows(obj.name)] as const));

  const rows = new Map<string, Row[]>();
  for (const [obj, all] of fetched) {
    const c = byObject.get(obj.name);
    const live = all.filter((r) => isLive(r, c === undefined ? conventionRule(obj) : c.publish, now, preview));
    rows.set(obj.name, sorted(live, c, daemon.locales));
  }
  const assetsObject = daemon.assetsObject ?? null;
  const assets = fetched.find(([obj]) => obj.name === assetsObject)?.[1] ?? [];
  return {
    objects: daemon.objects,
    collections,
    rows,
    locales: daemon.locales,
    title: daemon.title ?? null,
    assetsObject,
    assets,
    assetsById: new Map(assets.map((a) => [a.id, a])),
  };
}

export type Resolved =
  | { kind: 'home'; collection: Collection; record: Row }
  | { kind: 'list'; collection: Collection; records: Row[]; page: number; pageCount: number; total: number }
  | { kind: 'item'; collection: Collection; record: Row };

// The home record lives at '/' only, so a site never serves the same page at two URLs.
export function isHomeRecord(collection: Collection, row: Row): boolean {
  return collection.path === '/' && collection.home !== null && slugOf(row) === collection.home;
}

export function resolve(match: RouteMatch, content: SiteContent): Resolved | null {
  if (match.kind === 'home') {
    const root = content.collections.find((c) => c.path === '/' && c.home !== null);
    const record = root === undefined ? undefined : content.rows.get(root.object)?.find((r) => slugOf(r) === root.home);
    return root === undefined || record === undefined ? null : { kind: 'home', collection: root, record };
  }
  const collection = content.collections.find((c) => c.object === match.collection);
  if (collection === undefined) return null;
  const all = content.rows.get(collection.object) ?? [];
  if (match.kind === 'item') {
    const wanted = match.slug.toLowerCase();
    const record = all.find((r) => slugOf(r) === wanted);
    return record === undefined || isHomeRecord(collection, record) ? null : { kind: 'item', collection, record };
  }
  // The '/' collection has no list page: '/' is its home record.
  if (collection.path === '/' || !collection.list) return null;
  const pageCount = Math.max(1, Math.ceil(all.length / collection.perPage));
  if (match.page > pageCount) return null;
  const start = (match.page - 1) * collection.perPage;
  return { kind: 'list', collection, records: all.slice(start, start + collection.perPage), page: match.page, pageCount, total: all.length };
}
