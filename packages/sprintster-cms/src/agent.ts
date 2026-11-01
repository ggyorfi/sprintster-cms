import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
import { build } from './build.js';

export const AGENT_CONFIG_FILE = 'scms.agent.json';

const Site = z.strictObject({
  // The site's project folder, relative to the agent config.
  dir: z.string().min(1),
  app: z.url(),
  // Run in `dir` after a successful build, e.g. "pnpm exec wrangler deploy".
  deploy: z.string().min(1),
  user: z.string().min(1).optional(),
  // The name of an environment variable holding the password, so no secret sits in the file.
  passwordEnv: z.string().min(1).optional(),
});
export type AgentSite = z.infer<typeof Site>;

const AgentConfig = z.strictObject({ sites: z.array(Site).min(1) });

export function loadAgentConfig(path: string): AgentSite[] {
  const sites = AgentConfig.parse(JSON.parse(readFileSync(path, 'utf8'))).sites;
  return sites.map((s) => ({ ...s, dir: resolve(dirname(path), s.dir) }));
}

interface Job {
  id: string;
}

export interface Publisher {
  build(site: AgentSite): Promise<string>;
  deploy(site: AgentSite): Promise<void>;
}

const OUTPUT_TAIL = 15;

function runShell(command: string, cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, { cwd, shell: true });
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done();
      else fail(new Error(`'${command}' exited ${code}:\n${output.trim().split('\n').slice(-OUTPUT_TAIL).join('\n')}`));
    });
  });
}

export const shellPublisher: Publisher = {
  async build(site) {
    const report = await build({ root: site.dir });
    return `${report.pages} pages, ${report.renditions} images`;
  },
  deploy: (site) => runShell(site.deploy, site.dir),
};

function authHeaders(site: AgentSite): Record<string, string> {
  if (site.user === undefined) return {};
  const password = site.passwordEnv === undefined ? '' : (process.env[site.passwordEnv] ?? '');
  return { authorization: `Basic ${Buffer.from(`${site.user}:${password}`).toString('base64')}` };
}

export interface AgentOptions {
  publisher?: Publisher;
  log?: (message: string) => void;
  pingSeconds?: number;
  maxBackoffSeconds?: number;
}

export interface AgentHandle {
  stop(): void;
}

// Claims on every push and on every (re)connect, so a request made while the agent was offline is still picked up.
export function runAgent(sites: readonly AgentSite[], opts: AgentOptions = {}): AgentHandle {
  const publisher = opts.publisher ?? shellPublisher;
  const log = opts.log ?? ((m: string) => console.log(`${new Date().toISOString()} ${m}`));
  const stops: Array<() => void> = [];

  for (const site of sites) {
    const name = site.dir.split('/').pop() ?? site.dir;
    const headers = authHeaders(site);
    const route = (path: string) => `${site.app}/plugins/publish${path}`;
    let draining = false;
    let again = false;
    let stopped = false;
    let backoff = 1;
    let socket: WebSocket | undefined;
    let ping: NodeJS.Timeout | undefined;
    let retry: NodeJS.Timeout | undefined;

    const report = (job: Job, ok: boolean, message: string) =>
      fetch(route(`/jobs/${job.id}/done`), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ok, message }),
      });

    async function drain(): Promise<void> {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          for (;;) {
            const res = await fetch(route('/jobs/claim'), { method: 'POST', headers });
            if (res.status === 204) break;
            if (!res.ok) throw new Error(`claim failed with status ${res.status}`);
            const { job } = (await res.json()) as { job: Job };
            const started = Date.now();
            log(`${name}: publishing`);
            try {
              const built = await publisher.build(site);
              await publisher.deploy(site);
              const message = `${built}, deployed in ${((Date.now() - started) / 1000).toFixed(0)}s`;
              await report(job, true, message);
              log(`${name}: published, ${message}`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await report(job, false, message);
              log(`${name}: publish failed: ${message}`);
            }
          }
        } while (again);
      } catch (err) {
        log(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        draining = false;
      }
    }

    function connect(): void {
      if (stopped) return;
      socket = new WebSocket(route('/channels/jobs').replace(/^http/, 'ws'), { headers });
      socket.on('open', () => {
        backoff = 1;
        log(`${name}: connected to ${site.app}`);
        ping = setInterval(() => socket?.ping(), (opts.pingSeconds ?? 30) * 1000);
        void drain();
      });
      socket.on('message', () => void drain());
      socket.on('error', () => {});
      socket.on('close', () => {
        clearInterval(ping);
        if (stopped) return;
        log(`${name}: disconnected, retrying in ${backoff}s`);
        retry = setTimeout(connect, backoff * 1000);
        backoff = Math.min(backoff * 2, opts.maxBackoffSeconds ?? 60);
      });
    }

    connect();
    stops.push(() => {
      stopped = true;
      clearInterval(ping);
      clearTimeout(retry);
      socket?.close();
    });
  }

  return { stop: () => stops.forEach((s) => s()) };
}
