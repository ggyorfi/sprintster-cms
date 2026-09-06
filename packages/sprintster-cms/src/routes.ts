import type { SiteConfig } from './config.js';

export type RouteMatch =
  | { kind: 'home' }
  | { kind: 'postIndex'; page: number }
  | { kind: 'post'; slug: string }
  | { kind: 'category'; slug: string }
  | { kind: 'tag'; slug: string }
  | { kind: 'page'; slug: string };

export interface UrlSpace {
  routes: SiteConfig['routes'];
  base: string;
}

export function urlSpace(site: SiteConfig, preview = false): UrlSpace {
  return { routes: site.routes, base: preview ? site.server.preview : '' };
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s !== '');
}

export function matchRoute(pathname: string, space: UrlSpace): RouteMatch | null {
  if (space.base !== '' && !(pathname === space.base || pathname.startsWith(`${space.base}/`))) return null;
  const rest = space.base === '' ? pathname : pathname.slice(space.base.length);
  const parts = segments(rest).map((s) => decodeURIComponent(s));
  const { posts, categories, tags } = space.routes;

  if (parts.length === 0) return { kind: 'home' };

  if (parts[0] === posts) {
    if (parts.length === 1) return { kind: 'postIndex', page: 1 };
    // A post slugged 'page' is shadowed by pagination; the index owns this shape.
    if (parts.length === 3 && parts[1] === 'page') {
      const n = Number(parts[2]);
      return Number.isInteger(n) && n > 0 ? { kind: 'postIndex', page: n } : null;
    }
    return parts.length === 2 ? { kind: 'post', slug: parts[1] as string } : null;
  }

  if (parts[0] === categories) return parts.length === 2 ? { kind: 'category', slug: parts[1] as string } : null;
  if (parts[0] === tags) return parts.length === 2 ? { kind: 'tag', slug: parts[1] as string } : null;

  return parts.length === 1 ? { kind: 'page', slug: parts[0] as string } : null;
}

export function urlFor(match: RouteMatch, space: UrlSpace): string {
  const { posts, categories, tags } = space.routes;
  const path = ((): string => {
    switch (match.kind) {
      case 'home':
        return '/';
      case 'postIndex':
        return match.page === 1 ? `/${posts}/` : `/${posts}/page/${match.page}/`;
      case 'post':
        return `/${posts}/${encodeURIComponent(match.slug)}/`;
      case 'category':
        return `/${categories}/${encodeURIComponent(match.slug)}/`;
      case 'tag':
        return `/${tags}/${encodeURIComponent(match.slug)}/`;
      case 'page':
        return `/${encodeURIComponent(match.slug)}/`;
    }
  })();
  return space.base === '' ? path : `${space.base}${path === '/' ? '/' : path}`;
}
