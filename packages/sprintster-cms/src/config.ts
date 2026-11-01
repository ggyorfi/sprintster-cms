import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SCMS_CONFIG_FILE = 'scms.config.json';

// `/`, or lowercase segments each after a slash; no trailing slash, so one URL has one spelling.
export const CollectionPath = z
  .string()
  .regex(/^\/$|^(\/[a-z0-9-]+)+$/, "must be '/' or lowercase segments each after a slash, e.g. '/blog'");

const Publish = z.union([
  z.literal(false),
  z.strictObject({ status: z.string().min(1).optional(), date: z.string().min(1).optional() }),
]);

const CollectionOverride = z.union([
  z.literal(false),
  z.strictObject({
    path: CollectionPath.optional(),
    sort: z
      .string()
      .regex(/^-?[A-Za-z_][A-Za-z0-9_]*$/, "must be a property name, with '-' in front for descending")
      .optional(),
    perPage: z.number().int().positive().optional(),
    home: z.string().min(1).optional(),
    list: z.boolean().optional(),
    publish: Publish.optional(),
  }),
]);
export type CollectionOverride = z.infer<typeof CollectionOverride>;

const Images = z.strictObject({
  widths: z.array(z.number().int().positive()).min(1).default([480, 768, 1200, 1920]),
  formats: z.array(z.enum(['avif', 'webp'])).min(1).default(['avif', 'webp']),
  quality: z.number().int().min(1).max(100).default(75),
  cacheDir: z.string().min(1).default('.scms/cache'),
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

export function prefixesOf(server: z.infer<typeof Server>): string[] {
  return [server.admin, server.api, server.assets, server.preview];
}

// prefault, not default: a nested `.default({})` is taken verbatim, so inner defaults never fill in.
const SiteConfigFields = z.strictObject({
  configVersion: z.literal('1').default('1'),
  outDir: z.string().default('dist'),
  theme: z.string().default('default'),
  collections: z.record(z.string(), CollectionOverride).default({}),
  images: Images.prefault({}),
  pagination: Pagination.prefault({}),
  server: Server.prefault({}),
});

export const SiteConfigSchema = SiteConfigFields.refine(
  (c) => new Set(prefixesOf(c.server)).size === prefixesOf(c.server).length,
  { message: 'server.admin, server.api, server.assets and server.preview must differ', path: ['server'] },
);

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

export function parseSiteConfig(raw: unknown): SiteConfig {
  if (raw !== null && typeof raw === 'object' && ('langs' in raw || 'defaultLang' in raw)) {
    throw new Error(
      `${SCMS_CONFIG_FILE}: 'langs' and 'defaultLang' moved to the app config as "locales" (sprintster.config.json, app.locales), default first. See docs/ADR/0003-languages-in-urls.md`,
    );
  }
  if (raw !== null && typeof raw === 'object' && 'routes' in raw) {
    throw new Error(
      `${SCMS_CONFIG_FILE}: 'routes' was replaced by 'collections', e.g. "collections": { "post": { "path": "/blog" }, "page": { "path": "/", "home": "home" } }. See docs/ADR/0002-collections-and-routes.md`,
    );
  }
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
