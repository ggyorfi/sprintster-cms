import type { ObjectConfig, PropertyConfig } from 'sprintster';
import { inLocale, slugOf, type Resolved, type SiteContent } from './content.js';
import type { Row } from './daemon.js';
import type { ImageSeam, RenderedImage } from './images.js';
import { urlFor, type RouteMatch, type UrlSpace } from './routes.js';

export interface RecordView {
  id: string;
  object: string;
  url: string | null;
  // Markdown fields before rendering, in the page's language, for templates that rewrite it and call markdownify.
  $raw: Record<string, string>;
  referencedBy?: Record<string, RecordView[]>;
  [field: string]: unknown;
}

export interface SiteView {
  title: string | null;
  time: string;
  lang: string | null;
  locales: readonly string[];
  // The home page in the current language.
  home: string;
}

export interface AlternateView {
  lang: string;
  url: string;
}

export interface PaginatorView {
  page: number;
  total_pages: number;
  total_records: number;
  records: RecordView[];
  previous_page_path: string | null;
  next_page_path: string | null;
}

export interface TemplateData {
  site: SiteView;
  page: RecordView | null;
  records: RecordView[];
  paginator: PaginatorView | null;
  collection: string | null;
  // The same page in every language, the current one included.
  alternates: AlternateView[];
  // A singleton is its one record.
  data: Record<string, RecordView[] | RecordView | null>;
}

export interface ViewContext {
  content: SiteContent;
  space: UrlSpace;
  images: ImageSeam;
  renderMarkdown: (source: string) => string;
  now?: Date;
}

function idsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function isTranslated(prop: PropertyConfig): boolean {
  return (prop.type === 'text' || prop.type === 'markdown') && (prop as { translated?: boolean }).translated === true;
}

export function createViews(ctx: ViewContext) {
  const { content } = ctx;
  const objects = new Map<string, ObjectConfig>(content.objects.map((o) => [o.name, o]));
  const collectionOf = new Map(content.collections.map((c) => [c.object, c]));
  const rowById = new Map<string, Map<string, Row>>(
    [...content.rows].map(([name, rows]) => [name, new Map(rows.map((r) => [r.id, r]))]),
  );
  const memo = new Map<string, RecordView>();

  function image(id: string): RenderedImage | null {
    return ctx.images({ assetId: id, alt: '', transform: {} });
  }

  function field(prop: PropertyConfig, raw: unknown, depth: number): unknown {
    const value = isTranslated(prop) ? inLocale(raw, content.locales, ctx.space.lang ?? undefined) : raw;
    if (prop.type === 'markdown') return ctx.renderMarkdown(typeof value === 'string' ? value : '');
    if (prop.type !== 'ref' && prop.type !== 'refs') return value;
    const ids = idsOf(value);
    if (prop.target === content.assetsObject) {
      // The asset record rides along as `record`, so a template can read its caption, video or other fields.
      const pictures = ids.flatMap((id) => {
        const picture = image(id);
        const row = rowById.get(prop.target)?.get(id);
        return picture === null ? [] : [{ ...picture, record: row === undefined ? null : view(prop.target, row, depth + 1) }];
      });
      return prop.type === 'ref' ? (pictures[0] ?? null) : pictures;
    }
    // One level only, so a cycle of refs cannot recurse.
    if (depth > 0) return value;
    const targets = ids
      .map((id) => rowById.get(prop.target)?.get(id))
      .filter((r): r is Row => r !== undefined)
      .map((r) => view(prop.target, r, depth + 1));
    return prop.type === 'ref' ? (targets[0] ?? null) : targets;
  }

  function view(objectName: string, row: Row, depth = 0): RecordView {
    const key = `${objectName}:${row.id}:${depth}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const out: RecordView = { id: row.id, object: objectName, url: null, $raw: {} };
    for (const prop of objects.get(objectName)?.properties ?? []) {
      if (prop.name === 'id') continue;
      if (prop.type === 'markdown') {
        const source = isTranslated(prop) ? inLocale(row[prop.name], content.locales, ctx.space.lang ?? undefined) : row[prop.name];
        out.$raw[prop.name] = typeof source === 'string' ? source : '';
      }
      // Resolved on first read: resolving an image demands its renditions, and only images a template shows may be encoded.
      let value: unknown;
      let resolved = false;
      Object.defineProperty(out, prop.name, {
        enumerable: true,
        get: () => {
          if (!resolved) {
            value = field(prop, row[prop.name], depth);
            resolved = true;
          }
          return value;
        },
      });
    }
    if (collectionOf.has(objectName) && typeof row['slug'] === 'string') {
      out.url = urlFor({ kind: 'item', collection: objectName, slug: row['slug'] }, ctx.space);
    }
    memo.set(key, out);
    return out;
  }

  function referencedBy(objectName: string, row: Row): Record<string, RecordView[]> {
    const out: Record<string, RecordView[]> = {};
    for (const c of content.collections) {
      const props = (objects.get(c.object)?.properties ?? []).filter(
        (p) => (p.type === 'ref' || p.type === 'refs') && p.target === objectName,
      );
      if (props.length === 0) continue;
      const hits = (content.rows.get(c.object) ?? []).filter((r) => props.some((p) => idsOf(r[p.name]).includes(row.id)));
      if (hits.length > 0) out[c.object] = hits.map((r) => view(c.object, r, 1));
    }
    return out;
  }

  function full(objectName: string, row: Row): RecordView {
    return Object.create(view(objectName, row), {
      referencedBy: { enumerable: true, get: () => referencedBy(objectName, row) },
    }) as RecordView;
  }

  function data(): TemplateData['data'] {
    const out: TemplateData['data'] = {};
    for (const obj of content.objects) {
      const rows = (content.rows.get(obj.name) ?? []).map((r) => view(obj.name, r));
      out[obj.name] = obj.singleton === true ? (rows[0] ?? null) : rows;
    }
    return out;
  }

  return { full, data };
}

export interface Rendering {
  // Most specific first.
  templates: string[];
  data: TemplateData;
}

function baseData(ctx: ViewContext, views: ReturnType<typeof createViews>): TemplateData {
  return {
    site: {
      title: ctx.content.title,
      time: (ctx.now ?? new Date()).toISOString(),
      lang: ctx.space.lang,
      locales: ctx.space.locales,
      home: urlFor({ kind: 'home' }, ctx.space),
    },
    page: null,
    records: [],
    paginator: null,
    collection: null,
    alternates: [],
    data: views.data(),
  };
}

export function notFoundData(ctx: ViewContext): TemplateData {
  return baseData(ctx, createViews(ctx));
}

function matchOf(resolved: Resolved): RouteMatch {
  const collection = resolved.collection.object;
  if (resolved.kind === 'home') return { kind: 'home' };
  if (resolved.kind === 'list') return { kind: 'list', collection, page: resolved.page };
  return { kind: 'item', collection, slug: String(resolved.record['slug']) };
}

export function viewFor(resolved: Resolved, ctx: ViewContext): Rendering {
  const views = createViews(ctx);
  const object = resolved.collection.object;
  const match = matchOf(resolved);
  const alternates = ctx.space.locales.map((lang) => ({ lang, url: urlFor(match, { ...ctx.space, lang }) }));
  const base = { ...baseData(ctx, views), collection: object, alternates };

  switch (resolved.kind) {
    case 'home':
      return { templates: ['home', `${object}-${slugOf(resolved.record)}`, object, 'item'], data: { ...base, page: views.full(object, resolved.record) } };
    case 'item':
      return { templates: [`${object}-${slugOf(resolved.record)}`, object, 'item'], data: { ...base, page: views.full(object, resolved.record) } };
    case 'list': {
      const records = resolved.records.map((r) => views.full(object, r));
      const link = (page: number) => urlFor({ kind: 'list', collection: object, page }, ctx.space);
      return {
        templates: [`${object}-list`, 'list'],
        data: {
          ...base,
          records,
          paginator: {
            page: resolved.page,
            total_pages: resolved.pageCount,
            total_records: resolved.total,
            records,
            previous_page_path: resolved.page > 1 ? link(resolved.page - 1) : null,
            next_page_path: resolved.page < resolved.pageCount ? link(resolved.page + 1) : null,
          },
        },
      };
    }
  }
}
