import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApiClient, ObjectConfig, readConfigFile } from 'sprintster';
import { z } from 'zod';

export const PROJECT_CONFIG_FILE = 'sprintster.config.json';

const HEALTH_TIMEOUT_MS = 3000;
const UNROUTABLE_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export type Fetch = typeof globalThis.fetch;

export interface Row {
  id: string;
  [key: string]: unknown;
}

export interface Asset {
  bytes: Uint8Array;
  contentType: string;
}

// A remote app over the network: a dropped connection or a 5xx is tried again before the build fails.
const ASSET_ATTEMPTS = 3;

export interface Daemon {
  baseUrl: string;
  objects: readonly ObjectConfig[];
  assetsObject?: string;
  title?: string;
  // The app's languages, default first; empty when it declares none.
  locales: readonly string[];
  object(name: string): ObjectConfig;
  rows(objectName: string): Promise<Row[]>;
  // One record as it is now, or null.
  record?(objectName: string, id: string): Promise<Row | null>;
  // Each record as published (ADR 7), or its current state when the app has no publish plugin.
  publishedRows?(objectName: string): Promise<Row[]>;
  asset(hash: string): Promise<Asset>;
}

export interface ConnectOptions {
  root?: string;
  env?: string;
  baseUrl?: string;
  fetch?: Fetch;
}

const ServerBlock = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().positive().default(3030),
});

const ConfigResponse = z.object({
  objects: z.array(ObjectConfig).min(1),
  assets: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  locales: z.array(z.string().min(1)).default([]),
});

export function resolveDaemonUrl(root: string = process.cwd(), env = 'dev'): string {
  const path = join(root, PROJECT_CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(`no ${PROJECT_CONFIG_FILE} in ${root}; run scms from a sprintster project`);
  }
  const raw = readConfigFile(path);
  const environments = z.record(z.string(), z.unknown()).parse(
    (raw as { environments?: unknown }).environments ?? {},
  );
  const environment = environments[env];
  if (environment === undefined) {
    throw new Error(`unknown environment '${env}' (have: ${Object.keys(environments).join(', ')})`);
  }
  const server = ServerBlock.parse((environment as { server?: unknown }).server ?? {});
  const host = UNROUTABLE_HOSTS.has(server.host) ? '127.0.0.1' : server.host;
  return `http://${host}:${server.port}`;
}

async function requireHealthy(baseUrl: string, fetchImpl: Fetch): Promise<void> {
  try {
    const res = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `no sprintster daemon at ${baseUrl} (${reason}).\nStart it first:\n\n  s8r daemon\n`,
    );
  }
}

export async function connectDaemon(opts: ConnectOptions = {}): Promise<Daemon> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? resolveDaemonUrl(opts.root, opts.env);
  await requireHealthy(baseUrl, fetchImpl);

  const res = await fetchImpl(`${baseUrl}/config`);
  if (!res.ok) throw new Error(`GET ${baseUrl}/config failed with status ${res.status}`);
  const { objects, assets, title, locales } = ConfigResponse.parse(await res.json());
  const byName = new Map(objects.map((o) => [o.name, o]));
  const client = createApiClient(baseUrl, { objects, fetch: fetchImpl });

  const object = (name: string): ObjectConfig => {
    const found = byName.get(name);
    if (found === undefined) {
      throw new Error(`the daemon serves no object '${name}' (has: ${[...byName.keys()].join(', ')})`);
    }
    return found;
  };

  return {
    baseUrl,
    objects,
    ...(assets === undefined ? {} : { assetsObject: assets }),
    ...(title === undefined ? {} : { title }),
    locales,
    object,
    rows: async (objectName) => {
      object(objectName);
      return client.object<Row>(objectName).list();
    },
    record: async (objectName, id) => {
      object(objectName);
      return client.object<Row>(objectName).get(id);
    },
    publishedRows: async (objectName) => {
      object(objectName);
      const rows: Row[] = [];
      let after: string | null = null;
      for (;;) {
        const url = `${baseUrl}/plugins/publish/records/${encodeURIComponent(objectName)}?limit=100${after === null ? '' : `&after=${after}`}`;
        const res = await fetchImpl(url);
        if (res.status === 404 && after === null) return client.object<Row>(objectName).list();
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        const page = (await res.json()) as { rows: Row[]; next: string | null };
        rows.push(...page.rows);
        if (page.next === null) return rows;
        after = page.next;
      }
    },
    asset: async (hash) => {
      const url = `${baseUrl}/assets/${hash}`;
      for (let attempt = 1; ; attempt++) {
        try {
          const assetRes = await fetchImpl(url);
          if (assetRes.status >= 500 && attempt < ASSET_ATTEMPTS) throw new Error(`status ${assetRes.status}`);
          if (!assetRes.ok) throw new Error(`GET ${url} failed with status ${assetRes.status}`);
          return {
            bytes: new Uint8Array(await assetRes.arrayBuffer()),
            contentType: assetRes.headers.get('content-type') ?? 'application/octet-stream',
          };
        } catch (err) {
          if (attempt >= ASSET_ATTEMPTS || (err instanceof Error && err.message.startsWith('GET '))) throw err;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    },
  };
}

export function withoutPrivate(daemon: Daemon, names: readonly string[]): Daemon {
  if (names.length === 0) return daemon;
  for (const name of names) daemon.object(name);
  if (daemon.assetsObject !== undefined && names.includes(daemon.assetsObject)) {
    throw new Error(`scms private: '${daemon.assetsObject}' is the app's assets object and cannot be private`);
  }
  const hidden = new Set(names);
  const objects = daemon.objects.filter((o) => !hidden.has(o.name));
  return {
    ...daemon,
    objects,
    object: (name) => {
      if (hidden.has(name)) throw new Error(`'${name}' is private in scms.config.json, so the site cannot read it`);
      return daemon.object(name);
    },
    rows: async (name) => {
      if (hidden.has(name)) throw new Error(`'${name}' is private in scms.config.json, so the site cannot read it`);
      return daemon.rows(name);
    },
    ...(daemon.publishedRows === undefined
      ? {}
      : {
          publishedRows: async (name: string) => {
            if (hidden.has(name)) throw new Error(`'${name}' is private in scms.config.json, so the site cannot read it`);
            return daemon.publishedRows!(name);
          },
        }),
  };
}
