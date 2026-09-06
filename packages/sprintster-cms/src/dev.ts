import { spawn } from 'node:child_process';
import { resolveDaemonUrl } from './daemon.js';
import { serve, type ServeOptions } from './serve.js';

const POLL_MS = 200;
const STARTUP_TIMEOUT_MS = 15_000;

async function waitForHealth(baseUrl: string, alive: () => boolean): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error('s8r daemon exited before it became healthy');
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(POLL_MS) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`s8r daemon at ${baseUrl} did not become healthy within ${STARTUP_TIMEOUT_MS}ms`);
}

export async function dev(opts: ServeOptions = {}): Promise<void> {
  const root = opts.root ?? process.cwd();
  const env = opts.env ?? 'dev';
  const baseUrl = resolveDaemonUrl(root, env);

  const daemon = spawn('s8r', ['daemon', '--env', env], { cwd: root, stdio: 'inherit' });
  let exited = false;
  daemon.on('exit', (code) => {
    exited = true;
    process.exit(code ?? 1);
  });
  daemon.on('error', (err) => {
    console.error(`could not start s8r daemon: ${err.message}`);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (!exited) daemon.kill(signal);
    });
  }

  await waitForHealth(baseUrl, () => !exited);
  await serve({ ...opts, root, env });
}
