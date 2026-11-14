import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { progress, type Log } from './progress.js';
import type { Row } from './daemon.js';

// ADR 10: the published records the agent keeps per site, and the last change it has applied.
export interface PublishedCopy {
  app: string;
  seq: number;
  objects: Record<string, Record<string, Row>>;
}

interface Change {
  object: string;
  id: string;
  record: Row | null;
}

export const copyPath = (siteDir: string) => join(siteDir, '.scms', 'published.json');

export async function readCopy(path: string, app: string): Promise<PublishedCopy> {
  try {
    const copy = JSON.parse(await readFile(path, 'utf8')) as PublishedCopy;
    if (copy.app === app && typeof copy.seq === 'number') return copy;
  } catch {
    // No copy yet, or one this agent cannot read: start from the first change.
  }
  return { app, seq: 0, objects: {} };
}

// Applies every change after the copy's sequence; null when the app has no change feed (older than ADR 10).
export async function syncCopy(app: string, path: string, fetchImpl: typeof fetch, log?: Log): Promise<PublishedCopy | null> {
  const copy = await readCopy(path, app);
  let after = copy.seq;
  const report = progress(log);
  report.say(after === 0 ? 'reading every published record' : 'reading published changes');
  let read = 0;
  for (;;) {
    const res = await fetchImpl(`${app}/plugins/publish/changes?after=${after}&limit=100`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`published changes failed with status ${res.status}`);
    const page = (await res.json()) as { changes: Change[]; last: number; next: number | null };
    for (const c of page.changes) {
      const records = (copy.objects[c.object] ??= {});
      if (c.record === null) delete records[c.id];
      else records[c.id] = c.record;
    }
    after = page.last;
    read += page.changes.length;
    report.step('published changes read', read);
    if (page.next === null) break;
  }
  copy.seq = after;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(copy));
  return copy;
}
