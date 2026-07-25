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
});

export const SiteConfigSchema = SiteConfigFields.transform((c) => ({
  ...c,
  defaultLang: c.defaultLang ?? c.langs[0],
})).refine((c) => c.langs.includes(c.defaultLang), {
  message: 'defaultLang must be one of langs',
  path: ['defaultLang'],
});

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
