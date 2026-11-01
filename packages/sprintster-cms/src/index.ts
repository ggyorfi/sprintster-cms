import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export * from './agent.js';
export * from './build.js';
export * from './collections.js';
export * from './config.js';
export * from './content.js';
export * from './daemon.js';
export * from './filters.js';
export * from './images.js';
export * from './markdown.js';
export * from './media.js';
export * from './render.js';
export * from './renditions.js';
export * from './theme.js';
export * from './viewmodel.js';
export * from './routes.js';
export * from './serve.js';
export * from './dev.js';

export interface EnvPaths {
  db?: string;
  blobs?: string;
}

export function loadEnvPaths(env: string, cwd: string = process.cwd()): EnvPaths {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, 'sprintster.config.json'), 'utf8'));
    const e = raw?.environments?.[env];
    const db = e?.backend?.kind === 'sqlite' ? e.backend.path : undefined;
    return { db, blobs: e?.blobs?.dir };
  } catch {
    return {};
  }
}

export function reset(env: string): void {
  const { db, blobs } = loadEnvPaths(env);
  const dbPath = db ?? '.sprintster/dev.db';
  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, blobs ?? '.sprintster/binary-data'];
  for (const target of targets) {
    rmSync(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }
  console.log('reset complete; next daemon start recreates a clean store');
}

