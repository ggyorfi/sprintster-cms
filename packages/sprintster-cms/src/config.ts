import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SCMS_CONFIG_FILE = 'scms.config.json';

const Routes = z.strictObject({
  posts: z.string().default('blog'),
  categories: z.string().default('categories'),
  tags: z.string().default('tags'),
  homeSlug: z.string().default('home'),
});

const Images = z.strictObject({
  widths: z.array(z.number().int().positive()).min(1).default([480, 768, 1200, 1920]),
  formats: z.array(z.enum(['avif', 'webp'])).min(1).default(['avif', 'webp']),
  quality: z.number().int().min(1).max(100).default(75),
});

const Pagination = z.strictObject({
  perPage: z.number().int().positive().default(10),
});

const Prefix = z.string().regex(/^\/[a-z0-9-]+$/, 'must be a single lowercase path segment, starting with a slash');

const Server = z.strictObject({
  port: z.number().int().positive().default(4000),
  admin: Prefix.default('/admin'),
  api: Prefix.default('/api'),
  assets: Prefix.default('/assets'),
  preview: Prefix.default('/preview'),
});

function prefixesOf(server: z.infer<typeof Server>): string[] {
  return [server.admin, server.api, server.assets, server.preview];
}

// prefault, not default: a nested `.default({})` is taken verbatim, so inner defaults never fill in.
const SiteConfigFields = z.strictObject({
  configVersion: z.literal('1').default('1'),
  outDir: z.string().default('dist'),
  theme: z.string().default('default'),
  langs: z.array(z.string().min(2)).min(1).default(['en']),
  defaultLang: z.string().min(2).optional(),
  routes: Routes.prefault({}),
  images: Images.prefault({}),
  pagination: Pagination.prefault({}),
  server: Server.prefault({}),
});

export const SiteConfigSchema = SiteConfigFields.transform((c) => ({
  ...c,
  defaultLang: c.defaultLang ?? c.langs[0],
}))
  .refine((c) => c.langs.includes(c.defaultLang), {
    message: 'defaultLang must be one of langs',
    path: ['defaultLang'],
  })
  .refine((c) => new Set(prefixesOf(c.server)).size === prefixesOf(c.server).length, {
    message: 'server.admin, server.api, server.assets and server.preview must differ',
    path: ['server'],
  })
  .refine(
    (c) => {
      const reserved = new Set(prefixesOf(c.server).map((p) => p.slice(1)));
      return [c.routes.posts, c.routes.categories, c.routes.tags].every((r) => !reserved.has(r));
    },
    {
      message: 'routes.posts, routes.categories and routes.tags may not collide with a server prefix',
      path: ['routes'],
    },
  );

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

export function parseSiteConfig(raw: unknown): SiteConfig {
  const result = SiteConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${SCMS_CONFIG_FILE} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadSiteConfig(root: string = process.cwd()): SiteConfig {
  const path = join(root, SCMS_CONFIG_FILE);
  if (!existsSync(path)) return parseSiteConfig({});
  return parseSiteConfig(JSON.parse(readFileSync(path, 'utf8')));
}
