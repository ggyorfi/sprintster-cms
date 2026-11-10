import type { SiteConfig } from './config.js';
import type { Resolved, SiteContent } from './content.js';
import { createFileLinks, type FileLinks } from './files.js';
import { createSourceSeam, type ImageSeam } from './images.js';
import { MAINTENANCE_TEMPLATE } from './maintenance.js';
import { createMarkdown } from './markdown.js';
import type { UrlSpace } from './routes.js';
import type { Theme } from './theme.js';
import { notFoundData, viewFor, type ViewContext } from './viewmodel.js';

export interface Renderer {
  page(resolved: Resolved): string;
  notFound(): string;
  maintenance(): string;
}

export interface RendererOptions {
  images?: ImageSeam;
  files?: FileLinks;
  now?: Date;
}

export function createRenderer(
  theme: Theme,
  site: SiteConfig,
  content: SiteContent,
  space: UrlSpace,
  opts: RendererOptions = {},
): Renderer {
  const images = opts.images ?? createSourceSeam(content, site);
  const files = opts.files ?? createFileLinks(content, site);
  const md = createMarkdown({ images, files, assetsPrefix: site.server.assets });
  const markdownify = (value: unknown): string => md.render(typeof value === 'string' ? value : '');
  const ctx: ViewContext = {
    content,
    space,
    images,
    renderMarkdown: (source) => md.render(source),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  };

  return {
    page(resolved) {
      const { templates, data } = viewFor(resolved, ctx);
      const template = templates.find((t) => theme.has(t));
      if (template === undefined) throw new Error(`theme '${theme.dirs[0]}' has none of ${templates.map((t) => `${t}.eta`).join(', ')}`);
      return theme.render(template, data, { markdownify });
    },
    notFound() {
      return theme.render('404', notFoundData(ctx), { markdownify });
    },
    maintenance() {
      return theme.renderAlone(MAINTENANCE_TEMPLATE, notFoundData(ctx), { markdownify });
    },
  };
}
