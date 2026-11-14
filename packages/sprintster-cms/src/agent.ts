import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
import { build } from './build.js';
import { copyPath, syncCopy } from './published-copy.js';

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
  build(site: AgentSite, log?: (message: string) => void): Promise<string>;
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
  async build(site, log) {
    const headers = authHeaders(site);
    const withHeaders: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
    // ADR 10: only the published changes since the last build cross the network; the build reads the local copy.
    const copy = await syncCopy(site.app.replace(/\/$/, ''), copyPath(site.dir), withHeaders, log);
    const published = copy === null ? undefined : (name: string) => Object.values(copy.objects[name] ?? {});
    const report = await build({ root: site.dir, app: site.app, headers, ...(published === undefined ? {} : { published }), ...(log === undefined ? {} : { log }) });
    return report.maintenance ? 'maintenance page only' : `${report.pages} pages, ${report.renditions} images`;
  },
  deploy: (site) => runShell(site.deploy, site.dir),
};

function authHeaders(site: AgentSite): Record<string, string> {
  if (site.user === undefined) return {};
  const password = site.passwordEnv === undefined ? '' : (process.env[site.passwordEnv] ?? '');
  return { authorization: `Basic ${Buffer.from(`${site.user}:${password}`).toString('base64')}` };
}

// ADR 9: the dates of every schedule still holding, and when the last successful build started reading.
export interface Schedule {
  dates: number[];
  lastBuilt: number | null;
}

export type Scheduler = (site: AgentSite) => Promise<Schedule>;

export const appScheduler: Scheduler = async (site) => {
  const res = await fetch(`${site.app}/plugins/publish/schedule`, { headers: authHeaders(site) });
  if (!res.ok) throw new Error(`schedule request failed with status ${res.status}`);
  const body = (await res.json()) as { dates: string[]; lastBuilt: string | null };
  return { dates: body.dates.map((d) => Date.parse(d)), lastBuilt: body.lastBuilt === null ? null : Date.parse(body.lastBuilt) };
};

// setTimeout takes at most about 24.8 days; a later date is planned again when this much has passed.
const MAX_TIMER_MS = 2 ** 31 - 1;
// Fired a moment after the date, so the build reads the record as due.
const DUE_SLACK_MS = 1000;

export interface AgentOptions {
  publisher?: Publisher;
  scheduler?: Scheduler;
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
  const scheduler = opts.scheduler ?? appScheduler;
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
    let due: NodeJS.Timeout | undefined;

    const requestPublish = async (why: string) => {
      log(`${name}: ${why}, publishing`);
      const res = await fetch(route('/requests'), { method: 'POST', headers });
      if (!res.ok) throw new Error(`publish request failed with status ${res.status}`);
    };

    // One timer per site for the next publish date; a date passed since the last build is published at once (ADR 7).
    async function plan(): Promise<void> {
      clearTimeout(due);
      if (stopped) return;
      try {
        const { dates, lastBuilt } = await scheduler(site);
        const now = Date.now();
        if (lastBuilt !== null && dates.some((d) => d > lastBuilt && d <= now)) {
          await requestPublish('a scheduled date passed while no build ran');
          return;
        }
        const next = Math.min(...dates.filter((d) => d > now));
        if (!Number.isFinite(next)) return;
        const wait = next - now + DUE_SLACK_MS;
        due = setTimeout(() => void (wait > MAX_TIMER_MS ? plan() : requestPublish('a scheduled date arrived').catch((err: unknown) => log(`${name}: ${String(err)}`))), Math.min(wait, MAX_TIMER_MS));
        log(`${name}: next scheduled publish ${new Date(next).toISOString()}`);
      } catch (err) {
        log(`${name}: cannot plan scheduled publishing: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
              const built = await publisher.build(site, (m) => log(`${name}: ${m}`));
              log(`${name}: built, ${built}; deploying`);
              await publisher.deploy(site);
              const message = `${built}, deployed in ${((Date.now() - started) / 1000).toFixed(0)}s`;
              await report(job, true, message);
              log(`${name}: published, ${message}`);
              void plan();
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
        void plan();
      });
      socket.on('message', () => {
        void drain();
        void plan();
      });
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
      clearTimeout(due);
      socket?.close();
    });
  }

  return { stop: () => stops.forEach((s) => s()) };
}
