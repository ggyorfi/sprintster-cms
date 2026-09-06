import { serve as listen } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { loadSiteConfig, type SiteConfig } from './config.js';
import { loadContent, resolve } from './content.js';
import { connectDaemon, type Daemon } from './daemon.js';
import { createRenderer } from './render.js';
import { matchRoute, urlSpace } from './routes.js';
import { loadTheme, type Theme } from './theme.js';

export interface ServeOptions {
  root?: string;
  env?: string;
  port?: number;
}

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

async function forward(target: string, c: Context): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');
  const method = c.req.method;
  const init: RequestInit & { duplex?: 'half' } = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = c.req.raw.body;
    init.duplex = 'half';
  }
  return fetch(target, init);
}

export function createSiteApp(site: SiteConfig, daemon: Daemon, theme: Theme): Hono {
  const app = new Hono();
  const { api, admin, preview } = site.server;

  app.all(`${api}/*`, (c) => {
    const url = new URL(c.req.url);
    return forward(`${daemon.baseUrl}${url.pathname.slice(api.length)}${url.search}`, c);
  });

  // The admin bundle resolves its assets and API from the URL it was served at, so the shell has to live at the trailing-slash form.
  app.get(`${admin}`, (c) => c.redirect(`${admin}/${new URL(c.req.url).search}`, 301));
  app.all(`${admin}/*`, (c) => {
    const url = new URL(c.req.url);
    return forward(`${daemon.baseUrl}${url.pathname.slice(admin.length)}${url.search}`, c);
  });

  app.use('/_theme/*', serveStatic({ root: theme.dir, rewriteRequestPath: (p) => p.replace(/^\/_theme/, '/static') }));

  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const isPreview = underPrefix(pathname, preview);
    const space = urlSpace(site, isPreview);
    const match = matchRoute(pathname, space);
    const content = await loadContent(daemon, { preview: isPreview });
    const renderer = createRenderer(theme, site, content, space);
    const resolved = match === null ? null : resolve(match, content, site);
    if (resolved === null) return c.html(renderer.notFound(), 404);
    return c.html(renderer.page(resolved));
  });

  return app;
}

export async function serve(opts: ServeOptions = {}): Promise<void> {
  const root = opts.root ?? process.cwd();
  const site = loadSiteConfig(root);
  const daemon = await connectDaemon({ root, ...(opts.env === undefined ? {} : { env: opts.env }) });
  const port = opts.port ?? site.server.port;
  const theme = loadTheme(site.theme, root);
  const app = createSiteApp(site, daemon, theme);

  listen({ fetch: app.fetch, port }, ({ port: bound }) => {
    console.log(`scms serve on http://127.0.0.1:${bound}`);
    console.log(`  site    /`);
    console.log(`  admin   ${site.server.admin}`);
    console.log(`  api     ${site.server.api} -> ${daemon.baseUrl}`);
    console.log(`  preview ${site.server.preview}`);
  });
}
