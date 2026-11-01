import type { Collection } from './collections.js';
import type { SiteConfig } from './config.js';

export type RouteMatch =
  | { kind: 'home' }
  | { kind: 'list'; collection: string; page: number }
  | { kind: 'item'; collection: string; slug: string };

export interface UrlSpace {
  collections: readonly Collection[];
  base: string;
  // Default first; empty for a site without languages.
  locales: readonly string[];
  lang: string | null;
}

export interface SpaceOptions {
  preview?: boolean;
  locales?: readonly string[];
  lang?: string;
}

export function urlSpace(site: SiteConfig, collections: readonly Collection[], opts: SpaceOptions = {}): UrlSpace {
  const locales = opts.locales ?? [];
  return {
    collections,
    base: opts.preview === true ? site.server.preview : '',
    locales,
    lang: opts.lang ?? locales[0] ?? null,
  };
}

function langPrefix(space: UrlSpace): string {
  return space.lang === null || space.lang === space.locales[0] ? '' : `/${space.lang}`;
}

// The default language has no prefix; every other one is the first segment after the preview base.
export function languageOf(pathname: string, base: string, locales: readonly string[]): string | null {
  const rest = base !== '' && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) : pathname;
  const first = segments(rest)[0];
  return first !== undefined && locales.slice(1).includes(first) ? first : (locales[0] ?? null);
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s !== '');
}

function pageNumber(segment: string | undefined): number | null {
  const n = Number(segment);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The '/' collection is tried last, so '/works/' is never read as a root record slugged 'works'.
export function matchRoute(pathname: string, space: UrlSpace): RouteMatch | null {
  const base = `${space.base}${langPrefix(space)}`;
  if (base !== '' && !(pathname === base || pathname.startsWith(`${base}/`))) return null;
  const rest = base === '' ? pathname : pathname.slice(base.length);
  const parts = segments(rest).map((s) => decodeURIComponent(s));
  if (parts.length === 0) return { kind: 'home' };

  for (const c of space.collections) {
    if (c.path === '/') continue;
    const prefix = segments(c.path);
    if (!prefix.every((s, i) => parts[i] === s)) continue;
    const tail = parts.slice(prefix.length);
    if (tail.length === 0) return { kind: 'list', collection: c.object, page: 1 };
    // A record slugged 'page' is shadowed by pagination; the list owns this shape.
    if (tail.length === 2 && tail[0] === 'page') {
      const page = pageNumber(tail[1]);
      return page === null ? null : { kind: 'list', collection: c.object, page };
    }
    return tail.length === 1 ? { kind: 'item', collection: c.object, slug: tail[0] as string } : null;
  }

  const root = space.collections.find((c) => c.path === '/');
  return root !== undefined && parts.length === 1 ? { kind: 'item', collection: root.object, slug: parts[0] as string } : null;
}

export function urlFor(match: RouteMatch, space: UrlSpace): string {
  const path = ((): string => {
    if (match.kind === 'home') return '/';
    const c = space.collections.find((x) => x.object === match.collection);
    if (c === undefined) throw new Error(`no collection for object '${match.collection}'`);
    const prefix = c.path === '/' ? '' : c.path;
    if (match.kind === 'list') return match.page === 1 ? `${prefix}/` : `${prefix}/page/${match.page}/`;
    return `${prefix}/${encodeURIComponent(match.slug)}/`;
  })();
  const base = `${space.base}${langPrefix(space)}`;
  return base === '' ? path : `${base}${path}`;
}
