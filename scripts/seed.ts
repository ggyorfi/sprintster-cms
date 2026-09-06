import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApiClient, type ObjectConfig } from 'sprintster';
import { connectDaemon, type Row } from 'sprintster-cms';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = process.argv[2] ?? join(repoRoot, 'examples', 'reference-site');

interface BlobRef {
  hash: string;
  filename: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  alt: string;
}

const daemon = await connectDaemon({ root: projectRoot });
const client = createApiClient(daemon.baseUrl, { objects: daemon.objects as ObjectConfig[] });

const existing = new Map<string, Row[]>();
for (const object of daemon.objects) existing.set(object.name, await daemon.rows(object.name));

function found(objectName: string, field: string, value: string): Row | undefined {
  return existing.get(objectName)?.find((row) => row[field] === value);
}

async function ensure(objectName: string, slug: string, values: Record<string, unknown>): Promise<string> {
  const already = found(objectName, 'slug', slug);
  if (already !== undefined) {
    if (Object.entries(values).every(([k, v]) => canonical(already[k]) === canonical(v))) {
      console.log(`  = ${objectName} ${slug}`);
      return already.id;
    }
    await client.object<Row>(objectName).update(already.id, values);
    console.log(`  ~ ${objectName} ${slug}`);
    return already.id;
  }
  const id = randomUUID();
  await client.object<Row>(objectName).add({ id, slug, ...values });
  console.log(`  + ${objectName} ${slug}`);
  return id;
}

// Key order differs between what /assets returns and what the engine stores, so compare canonically.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

// A singleton always exists, projected from config until first written, so it is updated rather than created.
async function ensureSingleton(objectName: string, values: Record<string, unknown>): Promise<string> {
  const current = (existing.get(objectName) ?? [])[0];
  const configured = current !== undefined && Object.entries(values).every(([k, v]) => canonical(current[k]) === canonical(v));
  if (configured) {
    console.log(`  = ${objectName}`);
    return current.id;
  }
  const updated = await client.object<Row>(objectName).update(current?.id ?? objectName, values);
  console.log(`  ~ ${objectName}`);
  return updated.id;
}

async function ensureNavItem(label: string, values: Record<string, unknown>): Promise<void> {
  if (found('navItem', 'label', label) !== undefined) {
    console.log(`  = navItem ${label}`);
    return;
  }
  await client.object<Row>('navItem').add({ id: randomUUID(), label, ...values });
  console.log(`  + navItem ${label}`);
}

// Fixture photos live in scripts/fixtures with their licences in scripts/fixtures/README.md.
async function uploadBlob(name: string, alt: string): Promise<BlobRef> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(readFileSync(join(repoRoot, 'scripts', 'fixtures', name)));
  const { width, height } = await sharp(bytes).metadata();
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), name);
  const res = await fetch(`${daemon.baseUrl}/assets`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload of ${name} failed with status ${res.status}`);
  const uploaded = (await res.json()) as { hash: string; size: number; contentType: string; filename: string };
  console.log(`  + blob ${name} ${uploaded.hash.slice(0, 12)}`);
  return { ...uploaded, width, height, alt };
}

function iso(daysFromToday: number): string {
  const base = Date.parse('2026-07-20T09:00:00Z');
  return new Date(base + daysFromToday * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

console.log(`seeding ${daemon.baseUrl} (${projectRoot})`);

async function ensureAsset(
  slug: string,
  values: { title: string; caption?: string; credit?: string; licence?: string },
  file: BlobRef,
): Promise<string> {
  const already = (existing.get('asset') ?? []).find((row) => row['title'] === values.title);
  if (already !== undefined) {
    if (canonical(already['file']) === canonical(file) && Object.entries(values).every(([k, v]) => already[k] === v)) {
      console.log(`  = asset ${slug}`);
      return already.id;
    }
    await client.object<Row>('asset').update(already.id, { file, ...values });
    console.log(`  ~ asset ${slug}`);
    return already.id;
  }
  const id = randomUUID();
  await client.object<Row>('asset').add({ id, file, ...values });
  console.log(`  + asset ${slug}`);
  return id;
}

const coverFile = await uploadBlob('harbour-at-dawn.jpg', 'Fishing boats moored in the harbour of Gdańsk at dawn');
const ogFile = await uploadBlob('movable-type.jpg', 'A case of metal movable type');

const cover = await ensureAsset(
  'harbour-at-dawn',
  {
    title: 'Harbour at dawn',
    caption: 'Dawn over the harbour of Gdańsk.',
    credit: 'Gerda Arendt, Wikimedia Commons',
    licence: 'CC0 1.0',
  },
  coverFile,
);
const ogImage = await ensureAsset(
  'movable-type',
  {
    title: 'Default social card',
    caption: 'Metal movable type.',
    credit: 'Willi Heidelbach, Wikimedia Commons',
    licence: 'CC BY 2.5',
  },
  ogFile,
);

await ensureSingleton('settings', {
  siteTitle: 'Reference Site',
  tagline: 'A sprintster-cms development fixture',
  description: 'Deterministic content used to develop and test the static site generator.',
  baseUrl: 'https://reference.example',
  defaultOgImage: ogImage,
  twitter: 'sprintster',
  github: 'sprintster/sprintster-cms',
});

const guides = await ensure('category', 'guides', {
  name: 'Guides',
  description: 'Step by step articles.',
});
const news = await ensure('category', 'news', {
  name: 'News',
  description: 'Project announcements.',
});

const tagStatic = await ensure('tag', 'static-sites', { name: 'Static sites' });
const tagMarkdown = await ensure('tag', 'markdown', { name: 'Markdown' });
const tagImages = await ensure('tag', 'images', { name: 'Images' });

const home = await ensure('page', 'home', {
  status: 'published',
  title: 'Home',
  body: ['# Reference Site', '', 'A fixture for the generator. It has *emphasis*, **strong** text and a list:', '', '- one', '- two', '- three', ''].join('\n'),
  order: 0,
  publishedAt: iso(-30),
  seoTitle: 'Reference Site',
  seoDescription: 'A sprintster-cms development fixture.',
});

const about = await ensure('page', 'about', {
  status: 'published',
  title: 'About',
  body: ['## About this site', '', 'Content lives in the event store and is read over the daemon API.', '', '> A blockquote, for the theme to style.', ''].join('\n'),
  order: 1,
  publishedAt: iso(-29),
  ogImage: cover,
});

await ensure('page', 'team', {
  status: 'published',
  title: 'Team',
  parent: about,
  body: ['### The team', '', 'A child page, so nested routing has something to chew on.', ''].join('\n'),
  order: 0,
  publishedAt: iso(-28),
});

await ensure('page', 'secret-draft', {
  status: 'draft',
  title: 'Unfinished page',
  body: 'This page is a draft and must never reach the output.\n',
  order: 99,
});

await ensure('post', 'hello-world', {
  status: 'published',
  title: 'Hello world',
  excerpt: 'The first post, with a cover image and two tags.',
  body: [
    '# Hello world',
    '',
    'The first post. It exercises headings, a fenced code block and a link.',
    '',
    '```js',
    "console.log('hello');",
    '```',
    '',
    'A [link to the about page](/about/).',
    '',
  ].join('\n'),
  cover: ogImage,
  category: guides,
  tags: [tagStatic, tagMarkdown],
  publishedAt: iso(-14),
});

await ensure('post', 'working-with-images', {
  status: 'published',
  title: 'Working with images',
  excerpt: 'A post whose cover and body reference two different asset records.',
  body: [
    '## Images in the body',
    '',
    `![A case of metal movable type](/assets/${ogImage})`,
    '',
    'The generator rewrites that URL to a processed, content-addressed file.',
    '',
  ].join('\n'),
  cover,
  category: guides,
  tags: [tagImages],
  publishedAt: iso(-7),
});

await ensure('post', 'release-notes', {
  status: 'published',
  title: 'Release notes',
  excerpt: 'A short post with no cover image.',
  body: 'Nothing but a paragraph, to check templates cope without a cover.\n',
  category: news,
  tags: [],
  publishedAt: iso(-2),
});

await ensure('post', 'scheduled-post', {
  status: 'published',
  title: 'Scheduled for later',
  excerpt: 'Published status, future date: must stay out of the build.',
  body: 'If you can read this on the built site, the publish filter is wrong.\n',
  category: news,
  tags: [],
  publishedAt: iso(3650),
});

await ensure('post', 'draft-post', {
  status: 'draft',
  title: 'Draft post',
  excerpt: 'Draft status: must stay out of the build.',
  body: 'If you can read this on the built site, the status filter is wrong.\n',
  category: news,
  tags: [],
});

await ensureNavItem('Home', { group: 'main', page: home, order: 0 });
await ensureNavItem('About', { group: 'main', page: about, order: 1 });
await ensureNavItem('Blog', { group: 'main', url: '/blog/', order: 2 });
await ensureNavItem('GitHub', { group: 'footer', url: 'https://github.com/sprintster', order: 0 });

console.log('\nseed complete');
for (const object of daemon.objects) {
  console.log(`  ${object.name.padEnd(9)} ${(await daemon.rows(object.name)).length} rows`);
}
