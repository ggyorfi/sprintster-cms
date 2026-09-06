import type { SiteConfig } from './config.js';
import type { Daemon, Row } from './daemon.js';
import type { RouteMatch } from './routes.js';

export interface SiteContent {
  posts: Row[];
  pages: Row[];
  categories: Row[];
  tags: Row[];
  navItems: Row[];
  assets: Row[];
  assetsById: Map<string, Row>;
  settings: Row | null;
}

export interface LoadOptions {
  preview?: boolean;
  now?: Date;
}

function slugOf(row: Row): string {
  const slug = row['slug'];
  return typeof slug === 'string' ? slug.toLowerCase() : '';
}

function publishedAtOf(row: Row): number {
  const at = row['publishedAt'];
  return typeof at === 'string' ? Date.parse(at) : 0;
}

// Live records only. Drafts and future dated records are content that exists but has not been published, which preview shows and the site does not.
function isLive(row: Row, now: number, preview: boolean): boolean {
  if (row['removed'] === true) return false;
  if (preview) return true;
  if ('status' in row && row['status'] !== 'published') return false;
  const at = row['publishedAt'];
  if (typeof at === 'string' && Date.parse(at) > now) return false;
  return true;
}

export async function loadContent(daemon: Daemon, opts: LoadOptions = {}): Promise<SiteContent> {
  const preview = opts.preview ?? false;
  const now = (opts.now ?? new Date()).getTime();
  const assetsObject = daemon.assetsObject ?? 'asset';

  const [posts, pages, categories, tags, navItems, assets, settings] = await Promise.all([
    daemon.rows('post'),
    daemon.rows('page'),
    daemon.rows('category'),
    daemon.rows('tag'),
    daemon.rows('navItem'),
    daemon.rows(assetsObject),
    daemon.rows('settings'),
  ]);

  const live = (rows: Row[]): Row[] => rows.filter((r) => isLive(r, now, preview));

  return {
    posts: live(posts).sort((a, b) => publishedAtOf(b) - publishedAtOf(a)),
    pages: live(pages),
    categories: live(categories),
    tags: live(tags),
    navItems: live(navItems).sort((a, b) => Number(a['order'] ?? 0) - Number(b['order'] ?? 0)),
    assets,
    assetsById: new Map(assets.map((a) => [a.id, a])),
    settings: settings[0] ?? null,
  };
}

export type Resolved =
  | { kind: 'home'; page: Row }
  | { kind: 'postIndex'; posts: Row[]; page: number; pageCount: number }
  | { kind: 'post'; post: Row }
  | { kind: 'page'; page: Row }
  | { kind: 'category'; category: Row; posts: Row[] }
  | { kind: 'tag'; tag: Row; posts: Row[] };

function bySlug(rows: Row[], slug: string): Row | undefined {
  const wanted = slug.toLowerCase();
  return rows.find((r) => slugOf(r) === wanted);
}

function refsOf(row: Row, property: string): string[] {
  const value = row[property];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function resolve(match: RouteMatch, content: SiteContent, site: SiteConfig): Resolved | null {
  switch (match.kind) {
    case 'home': {
      const page = bySlug(content.pages, site.routes.homeSlug);
      return page === undefined ? null : { kind: 'home', page };
    }
    case 'postIndex': {
      const perPage = site.pagination.perPage;
      const pageCount = Math.max(1, Math.ceil(content.posts.length / perPage));
      if (match.page > pageCount) return null;
      const start = (match.page - 1) * perPage;
      return {
        kind: 'postIndex',
        posts: content.posts.slice(start, start + perPage),
        page: match.page,
        pageCount,
      };
    }
    case 'post': {
      const post = bySlug(content.posts, match.slug);
      return post === undefined ? null : { kind: 'post', post };
    }
    case 'page': {
      const page = bySlug(content.pages, match.slug);
      return page === undefined ? null : { kind: 'page', page };
    }
    case 'category': {
      const category = bySlug(content.categories, match.slug);
      if (category === undefined) return null;
      return { kind: 'category', category, posts: content.posts.filter((p) => refsOf(p, 'category').includes(category.id)) };
    }
    case 'tag': {
      const tag = bySlug(content.tags, match.slug);
      if (tag === undefined) return null;
      return { kind: 'tag', tag, posts: content.posts.filter((p) => refsOf(p, 'tags').includes(tag.id)) };
    }
  }
}
