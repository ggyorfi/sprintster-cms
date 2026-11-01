import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { runAgent, type AgentHandle, type Publisher } from './agent.js';

interface FakeApp {
  url: string;
  queue(): void;
  done: Array<{ id: string; ok: boolean; message: string }>;
  sockets: Set<WebSocket>;
  auth: string[];
  close(): Promise<void>;
}

async function fakeApp(): Promise<FakeApp> {
  let queued: string[] = [];
  let next = 1;
  const done: FakeApp['done'] = [];
  const auth: string[] = [];
  const sockets = new Set<WebSocket>();
  const server: Server = createServer((req, res) => {
    auth.push(req.headers.authorization ?? '');
    if (req.url === '/plugins/publish/jobs/claim') {
      const id = queued.shift();
      if (id === undefined) return res.writeHead(204).end();
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ job: { id } }));
    }
    const m = /^\/plugins\/publish\/jobs\/(.+)\/done$/.exec(req.url ?? '');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (m !== null) done.push({ id: m[1]!, ...JSON.parse(body) });
      res.writeHead(200).end('{}');
    });
  });
  const wss = new WebSocketServer({ server, path: '/plugins/publish/channels/jobs' });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    queue() {
      queued = [...queued, `job-${next++}`];
      sockets.forEach((ws) => ws.send(JSON.stringify({ type: 'job' })));
    },
    done,
    sockets,
    auth,
    close: () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); server.close(() => r()); }),
  };
}

async function until(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 4000) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ok: Publisher = { build: async () => '3 pages, 0 images', deploy: async () => {} };
let agent: AgentHandle | undefined;
let app: FakeApp | undefined;
afterEach(async () => {
  agent?.stop();
  await app?.close();
});

describe('scms agent', () => {
  it('publishes a job queued before it connected, then each pushed one, with basic auth', async () => {
    app = await fakeApp();
    app.queue();
    process.env['TEST_AGENT_PASSWORD'] = 's3cret';
    agent = runAgent([{ dir: '/sites/demo', app: app.url, deploy: 'true', user: 'gabor', passwordEnv: 'TEST_AGENT_PASSWORD' }], { publisher: ok, log: () => {} });
    await until(() => app!.done.length === 1);
    app.queue();
    await until(() => app!.done.length === 2);
    expect(app.done.map((d) => [d.id, d.ok])).toEqual([['job-1', true], ['job-2', true]]);
    expect(app.done[0]!.message).toMatch(/^3 pages, 0 images, deployed in \d+s$/);
    expect(new Set(app.auth)).toEqual(new Set([`Basic ${Buffer.from('gabor:s3cret').toString('base64')}`]));
  });

  it('reports a failed build with its message', async () => {
    app = await fakeApp();
    app.queue();
    const failing: Publisher = { build: async () => { throw new Error('daemon not running'); }, deploy: async () => {} };
    agent = runAgent([{ dir: '/sites/demo', app: app.url, deploy: 'true' }], { publisher: failing, log: () => {} });
    await until(() => app!.done.length === 1);
    expect(app.done[0]).toMatchObject({ ok: false, message: 'daemon not running' });
  });

  it('reconnects after the connection drops and picks up what was queued meanwhile', async () => {
    app = await fakeApp();
    agent = runAgent([{ dir: '/sites/demo', app: app.url, deploy: 'true' }], { publisher: ok, log: () => {}, maxBackoffSeconds: 1 });
    await until(() => app!.sockets.size === 1);
    app.sockets.forEach((ws) => ws.terminate());
    await until(() => app!.sockets.size === 0);
    app.queue();
    await until(() => app!.done.length === 1);
  });
});
