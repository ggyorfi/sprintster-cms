import type { SiteConfig } from './config.js';
import type { Resolved, SiteContent } from './content.js';
import { createSourceSeam, type ImageSeam } from './images.js';
import { createMarkdown } from './markdown.js';
import type { UrlSpace } from './routes.js';
import type { Theme } from './theme.js';
import { siteView, viewFor, type TemplateData, type ViewContext } from './viewmodel.js';

export interface Renderer {
  page(resolved: Resolved): string;
  notFound(): string;
}

export interface RendererOptions {
  images?: ImageSeam;
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
  const md = createMarkdown({ images, assetsPrefix: site.server.assets });
  const ctx: ViewContext = {
    site,
    content,
    space,
    images,
    renderMarkdown: (source) => md.render(source),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  };

  return {
    page(resolved) {
      const { template, data } = viewFor(resolved, ctx);
      return theme.render(template, data);
    },
    notFound() {
      const data: TemplateData = { site: siteView(ctx), page: null, term: null, posts: [], paginator: null };
      return theme.render('404', data);
    },
  };
}
