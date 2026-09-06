import type { SiteConfig } from './config.js';
import type { Resolved, SiteContent } from './content.js';
import type { Row } from './daemon.js';
import { strip_html, truncatewords } from './filters.js';
import type { ImageSeam, RenderedImage } from './images.js';
import { urlFor, type UrlSpace } from './routes.js';

export interface TermView {
  id: string;
  name: string;
  slug: string;
  url: string;
  description: string | null;
}

export interface NavView {
  label: string;
  url: string;
  group: string;
}

export interface SiteView {
  title: string;
  tagline: string | null;
  description: string | null;
  url: string | null;
  twitter: string | null;
  github: string | null;
  nav: NavView[];
  footerNav: NavView[];
  categories: TermView[];
  tags: TermView[];
  time: string;
}

export interface ResourceView {
  kind: 'post' | 'page';
  id: string;
  title: string;
  slug: string;
  url: string;
  date: string | null;
  excerpt: string;
  content: string;
  image: RenderedImage | null;
  category: TermView | null;
  tags: TermView[];
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface PaginatorView {
  page: number;
  total_pages: number;
  total_posts: number;
  posts: ResourceView[];
  previous_page_path: string | null;
  next_page_path: string | null;
}

export interface TemplateData {
  site: SiteView;
  page: ResourceView | null;
  term: TermView | null;
  posts: ResourceView[];
  paginator: PaginatorView | null;
}

export interface ViewContext {
  site: SiteConfig;
  content: SiteContent;
  space: UrlSpace;
  images: ImageSeam;
  renderMarkdown: (source: string) => string;
  now?: Date;
}

function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function refsOf(row: Row, property: string): string[] {
  const value = row[property];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function termView(row: Row, kind: 'category' | 'tag', space: UrlSpace): TermView {
  const slug = text(row, 'slug') ?? '';
  return {
    id: row.id,
    name: text(row, 'name') ?? slug,
    slug,
    url: urlFor({ kind, slug }, space),
    description: text(row, 'description'),
  };
}

function imageOf(row: Row, property: string, ctx: ViewContext): RenderedImage | null {
  const [id] = refsOf(row, property);
  return id === undefined ? null : ctx.images({ assetId: id, alt: '', transform: {} });
}

export function resourceView(row: Row, kind: 'post' | 'page', ctx: ViewContext): ResourceView {
  const slug = text(row, 'slug') ?? '';
  const content = ctx.renderMarkdown(typeof row['body'] === 'string' ? row['body'] : '');
  const categoryId = refsOf(row, 'category')[0];
  const category = ctx.content.categories.find((c) => c.id === categoryId);
  const tagIds = new Set(refsOf(row, 'tags'));
  return {
    kind,
    id: row.id,
    title: text(row, 'title') ?? slug,
    slug,
    url: urlFor(kind === 'post' ? { kind: 'post', slug } : { kind: 'page', slug }, ctx.space),
    date: text(row, 'publishedAt'),
    excerpt: text(row, 'excerpt') ?? truncatewords(strip_html(content), 40),
    content,
    image: imageOf(row, 'cover', ctx) ?? imageOf(row, 'ogImage', ctx),
    category: category === undefined ? null : termView(category, 'category', ctx.space),
    tags: ctx.content.tags.filter((t) => tagIds.has(t.id)).map((t) => termView(t, 'tag', ctx.space)),
    seoTitle: text(row, 'seoTitle'),
    seoDescription: text(row, 'seoDescription'),
  };
}

function navView(rows: Row[], group: string, ctx: ViewContext): NavView[] {
  return rows
    .filter((r) => r['group'] === group)
    .map((r) => {
      const [pageId] = refsOf(r, 'page');
      const target = ctx.content.pages.find((p) => p.id === pageId);
      const url =
        target === undefined
          ? text(r, 'url') ?? '#'
          : urlFor({ kind: 'page', slug: text(target, 'slug') ?? '' }, ctx.space);
      return { label: text(r, 'label') ?? '', url, group };
    });
}

export function siteView(ctx: ViewContext): SiteView {
  const settings = ctx.content.settings;
  const read = (key: string): string | null => (settings === null ? null : text(settings, key));
  return {
    title: read('siteTitle') ?? 'Untitled site',
    tagline: read('tagline'),
    description: read('description'),
    url: read('baseUrl'),
    twitter: read('twitter'),
    github: read('github'),
    nav: navView(ctx.content.navItems, 'main', ctx),
    footerNav: navView(ctx.content.navItems, 'footer', ctx),
    categories: ctx.content.categories.map((c) => termView(c, 'category', ctx.space)),
    tags: ctx.content.tags.map((t) => termView(t, 'tag', ctx.space)),
    time: (ctx.now ?? new Date()).toISOString(),
  };
}

export interface Rendering {
  template: string;
  data: TemplateData;
}

export function viewFor(resolved: Resolved, ctx: ViewContext): Rendering {
  const site = siteView(ctx);
  const base: TemplateData = { site, page: null, term: null, posts: [], paginator: null };

  switch (resolved.kind) {
    case 'home':
      return { template: 'home', data: { ...base, page: resourceView(resolved.page, 'page', ctx), posts: ctx.content.posts.map((p) => resourceView(p, 'post', ctx)) } };
    case 'page':
      return { template: 'page', data: { ...base, page: resourceView(resolved.page, 'page', ctx) } };
    case 'post':
      return { template: 'post', data: { ...base, page: resourceView(resolved.post, 'post', ctx) } };
    case 'postIndex': {
      const posts = resolved.posts.map((p) => resourceView(p, 'post', ctx));
      return {
        template: 'index',
        data: {
          ...base,
          posts,
          paginator: {
            page: resolved.page,
            total_pages: resolved.pageCount,
            total_posts: ctx.content.posts.length,
            posts,
            previous_page_path: resolved.page > 1 ? urlFor({ kind: 'postIndex', page: resolved.page - 1 }, ctx.space) : null,
            next_page_path: resolved.page < resolved.pageCount ? urlFor({ kind: 'postIndex', page: resolved.page + 1 }, ctx.space) : null,
          },
        },
      };
    }
    case 'category':
      return { template: 'archive', data: { ...base, term: termView(resolved.category, 'category', ctx.space), posts: resolved.posts.map((p) => resourceView(p, 'post', ctx)) } };
    case 'tag':
      return { template: 'archive', data: { ...base, term: termView(resolved.tag, 'tag', ctx.space), posts: resolved.posts.map((p) => resourceView(p, 'post', ctx)) } };
  }
}
