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

describe('scms serve live socket', () => {
  it('relays the daemon\'s pushes on /admin/log/live and refuses other upgrades', async () => {
    const { createServer } = await import('node:http');
    const { WebSocketServer, default: WebSocket } = await import('ws');
    const { relayUpgrades } = await import('./serve.js');
    const daemon = new WebSocketServer({ port: 0 });
    const paths: string[] = [];
    daemon.on('connection', (ws, req) => {
      paths.push(req.url ?? '');
      ws.send(JSON.stringify({ position: 7 }));
    });
    const front = createServer();
    relayUpgrades(front, ['/api', '/admin'], `http://127.0.0.1:${(daemon.address() as { port: number }).port}`);
    await new Promise<void>((done) => front.listen(0, done));
    const port = (front.address() as { port: number }).port;
    const got = await new Promise<string>((done) => new WebSocket(`ws://127.0.0.1:${port}/admin/log/live`).on('message', (d) => done(d.toString())));
    expect(JSON.parse(got)).toEqual({ position: 7 });
    expect(paths).toEqual(['/log/live']);
    const refused = await new Promise<string>((done) => new WebSocket(`ws://127.0.0.1:${port}/elsewhere`).on('error', () => done('refused')));
    expect(refused).toBe('refused');
    front.close();
    daemon.close();
  });
});
