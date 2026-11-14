import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import type { Asset, Daemon, Row } from './daemon.js';
import { createMedia } from './media.js';

const site = parseSiteConfig({ images: { widths: [400, 800], formats: ['webp'] } });

async function jpeg(width: number, height: number, background: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer());
}

function fakeDaemon(blobs: Map<string, Uint8Array>): Daemon & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    baseUrl: 'http://daemon',
    objects: [],
    object: () => {
      throw new Error('unused');
    },
    rows: async () => [],
    asset: async (hash): Promise<Asset> => {
      fetched.push(hash);
      const bytes = blobs.get(hash);
      if (bytes === undefined) throw new Error(`no blob ${hash}`);
      return { bytes, contentType: 'image/jpeg' };
    },
  };
}

function contentOf(assets: Row[]): SiteContent {
  return { assets, assetsById: new Map(assets.map((a) => [a.id, a])) } as unknown as SiteContent;
}

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const record = (id: string, hash: string): Row => ({ id, file: { hash, contentType: 'image/jpeg' } });

let root: string;
let blobs: Map<string, Uint8Array>;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'scms-media-'));
  blobs = new Map([
    [hashA, await jpeg(1000, 500, '#4a7')],
    [hashB, await jpeg(600, 600, '#a47')],
  ]);
});

const cached = (): string[] => readdirSync(join(root, '.scms/cache/renditions')).sort();

async function renderAndFetch(daemon: Daemon, content: SiteContent, assetId: string): Promise<string[]> {
  const media = createMedia(daemon, site, root);
  const image = (await media.seam(content))({ assetId, alt: '', transform: {} });
  const urls = [image?.srcset, ...(image?.sources ?? []).map((s) => s.srcset)].flatMap((set) =>
    (set ?? '').split(', ').map((entry) => entry.split(' ')[0] as string),
  );
  for (const url of urls) expect(await media.rendition(url.slice('/assets/'.length))).not.toBeNull();
  return urls;
}

describe('createMedia', () => {
  it('encodes on first request and nothing on a second run, even after a restart', async () => {
    const content = contentOf([record('a1', hashA)]);
    const first = fakeDaemon(blobs);
    await renderAndFetch(first, content, 'a1');
    expect(cached()).toEqual(['aaaaaaaaaaaaaaaa-w400.jpg', 'aaaaaaaaaaaaaaaa-w400.webp', 'aaaaaaaaaaaaaaaa-w800.jpg', 'aaaaaaaaaaaaaaaa-w800.webp']);

    const second = fakeDaemon(blobs);
    await renderAndFetch(second, content, 'a1');
    expect(second.fetched).toEqual([]);
  });

  it('encodes only the new renditions when a record points at a replaced blob, leaving the old ones untouched', async () => {
    await renderAndFetch(fakeDaemon(blobs), contentOf([record('a1', hashA)]), 'a1');
    const before = new Map(cached().map((name) => [name, statSync(join(root, '.scms/cache/renditions', name)).mtimeMs]));

    const daemon = fakeDaemon(blobs);
    await renderAndFetch(daemon, contentOf([record('a1', hashB)]), 'a1');
    expect(daemon.fetched.every((h) => h === hashB)).toBe(true);
    for (const [name, mtime] of before) expect(statSync(join(root, '.scms/cache/renditions', name)).mtimeMs).toBe(mtime);
    expect(cached().filter((n) => n.startsWith('bbbb'))).toHaveLength(4);
  });

  it('keeps what it measured when the build fails partway, so a retry carries on', async () => {
    const records = Array.from({ length: 9 }, (_, i) => record(`r${i}`, String(i).repeat(64)));
    for (let i = 0; i < 8; i++) blobs.set(String(i).repeat(64), blobs.get(hashA)!);
    const media = createMedia(fakeDaemon(blobs), site, root);
    await expect(media.seam(contentOf(records))).rejects.toThrow(/no blob/);
    const probes = JSON.parse(readFileSync(join(root, '.scms/cache/probes.json'), 'utf8'));
    expect(Object.keys(probes)).toHaveLength(8);
  });

  it('measures an image it cannot read as one without renditions, instead of failing the build', async () => {
    blobs.set(hashB, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    await renderAndFetch(fakeDaemon(blobs), contentOf([record('a1', hashA), record('b1', hashB)]), 'a1');
    const probes = JSON.parse(readFileSync(join(root, '.scms/cache/probes.json'), 'utf8'));
    expect(probes[hashB]).toEqual({ width: 0, height: 0, format: null });
  });

  it('produces no files for an unreferenced library entry, and refuses a name no page asked for', async () => {
    const media = createMedia(fakeDaemon(blobs), site, root);
    await media.seam(contentOf([record('a1', hashA), record('b1', hashB)]));
    expect(await media.rendition('bbbbbbbbbbbbbbbb-w400.webp')).toBeNull();
    expect(await media.rendition('../../etc/passwd')).toBeNull();
    expect(readdirSync(join(root, '.scms/cache'))).toEqual(['probes.json']);
  });

  it('encodes a rendition once when two requests race for it', async () => {
    const daemon = fakeDaemon(blobs);
    const media = createMedia(daemon, site, root);
    (await media.seam(contentOf([record('a1', hashA)])))({ assetId: 'a1', alt: '', transform: {} });
    const fetchedBefore = daemon.fetched.length;
    await Promise.all([media.rendition('aaaaaaaaaaaaaaaa-w400.webp'), media.rendition('aaaaaaaaaaaaaaaa-w400.webp')]);
    expect(daemon.fetched.length - fetchedBefore).toBe(1);
  });
});
