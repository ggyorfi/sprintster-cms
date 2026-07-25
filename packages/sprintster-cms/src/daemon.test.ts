import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_CONFIG_FILE, connectDaemon, resolveDaemonUrl, type Fetch } from './daemon.js';

const settingsObject = {
  name: 'settings',
  title: 'Site settings',
  titlePlural: 'Site Settings',
  route: 'site-settings',
  singleton: true,
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'siteTitle', title: 'Site title', type: 'text' },
  ],
};

function projectDir(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'scms-daemon-'));
  writeFileSync(join(dir, PROJECT_CONFIG_FILE), JSON.stringify(config));
  return dir;
}

function environments(server?: unknown): unknown {
  return {
    configVersion: '1',
    app: { version: '1', objects: [] },
    environments: { dev: { backend: { kind: 'sqlite', path: '.sprintster/dev.db' }, ...(server === undefined ? {} : { server }) } },
  };
}

interface Call {
  url: string;
}

function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return value instanceof Uint8Array;
}

function stubFetch(routes: Record<string, unknown>, calls: Call[] = []): Fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (isBytes(body)) {
      return new Response(new Blob([body]), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return Response.json(body);
  }) as Fetch;
}

const healthy = { '/health': { status: 'ok' }, '/config': { objects: [settingsObject] } };

describe('resolveDaemonUrl', () => {
  it('reads host and port from the environment', () => {
    const dir = projectDir(environments({ host: '127.0.0.1', port: 3939 }));
    expect(resolveDaemonUrl(dir)).toBe('http://127.0.0.1:3939');
  });

  it('falls back to core defaults when the server block is absent', () => {
    expect(resolveDaemonUrl(projectDir(environments()))).toBe('http://127.0.0.1:3030');
  });

  it('rewrites a wildcard bind address to loopback', () => {
    const dir = projectDir(environments({ host: '0.0.0.0', port: 3939 }));
    expect(resolveDaemonUrl(dir)).toBe('http://127.0.0.1:3939');
  });

  it('names the known environments when one is missing', () => {
    expect(() => resolveDaemonUrl(projectDir(environments()), 'prod')).toThrow(/have: dev/);
  });

  it('explains itself outside a project', () => {
    expect(() => resolveDaemonUrl(mkdtempSync(join(tmpdir(), 'scms-empty-')))).toThrow(
      /run scms from a sprintster project/,
    );
  });
});

describe('connectDaemon', () => {
  it('tells the user to start the daemon when health fails', async () => {
    await expect(
      connectDaemon({ baseUrl: 'http://127.0.0.1:3939', fetch: stubFetch({}) }),
    ).rejects.toThrow(/s8r daemon/);
  });

  it('exposes the objects reported by the daemon', async () => {
    const daemon = await connectDaemon({ baseUrl: 'http://d', fetch: stubFetch(healthy) });
    expect(daemon.objects.map((o) => o.name)).toEqual(['settings']);
    expect(daemon.object('settings').route).toBe('site-settings');
  });

  it('reads rows over the resolved route, not the lowercased label', async () => {
    const calls: Call[] = [];
    const daemon = await connectDaemon({
      baseUrl: 'http://d',
      fetch: stubFetch({ ...healthy, '/site-settings': [{ id: 'a', siteTitle: 'Hello' }] }, calls),
    });
    expect(await daemon.rows('settings')).toEqual([{ id: 'a', siteTitle: 'Hello' }]);
    expect(calls.map((c) => c.url)).toContain('http://d/site-settings');
  });

  it('names the served objects when asked for an unknown one', async () => {
    const daemon = await connectDaemon({ baseUrl: 'http://d', fetch: stubFetch(healthy) });
    await expect(daemon.rows('page')).rejects.toThrow(/has: settings/);
  });

  it('fetches asset bytes with their content type', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const daemon = await connectDaemon({
      baseUrl: 'http://d',
      fetch: stubFetch({ ...healthy, '/assets/abc': bytes }),
    });
    const asset = await daemon.asset('abc');
    expect(asset.bytes).toEqual(bytes);
    expect(asset.contentType).toBe('image/png');
  });
});
