import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

export function build(): void {
  console.log('scms build: the static site generator is not implemented yet.');
}
