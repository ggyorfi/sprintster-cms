import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config.js';
import type { Daemon, Row } from './daemon.js';
import { createMedia } from './media.js';
import { createSiteApp } from './serve.js';
import { loadTheme } from './theme.js';
import { object } from './test-objects.js';

const objects = [object('media', 'media', [{ name: 'file', type: 'file' }])];
const hash = 'a'.repeat(64);
const doc: Row = { id: 'd1', file: { hash, filename: 'Report.pdf', contentType: 'application/pdf', size: 3 } };

describe('scms serve linked files', () => {
  it('serves a linked file from its one record, without loading the site', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scms-serve-'));
    writeFileSync(join(dir, 'layout.eta'), '<%~ it.content %>');
    const listed: string[] = [];
    const daemon: Daemon = {
      baseUrl: 'http://daemon',
      objects,
      assetsObject: 'media',
      locales: [],
      object: (name) => objects.find((o) => o.name === name)!,
      rows: async (name) => {
        listed.push(name);
        return [doc];
      },
      record: async (_name, id) => (id === 'd1' ? doc : null),
      asset: async (h) => ({ bytes: new Uint8Array(h === hash ? [1, 2, 3] : []), contentType: 'application/pdf' }),
    };
    const site = parseSiteConfig({});
    const app = createSiteApp(site, daemon, loadTheme(dir, dir), createMedia(daemon, site, dir));
    const ok = await app.request('/assets/d1/Report.pdf');
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await app.request('/assets/d1/Other.pdf')).status).toBe(404);
    expect((await app.request('/assets/nope/Report.pdf')).status).toBe(404);
    expect(listed).toEqual([]);
  });
});
