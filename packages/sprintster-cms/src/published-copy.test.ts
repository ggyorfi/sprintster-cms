import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncCopy } from './published-copy.js';

type Change = { object: string; id: string; seq: number; record: Record<string, unknown> | null };

// A feed that answers like the publish plugin: changes after a sequence, a page of `limit` at a time.
function feed(changes: Change[], seen: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.search);
    const after = Number(url.searchParams.get('after'));
    const limit = Number(url.searchParams.get('limit'));
    const page = changes.filter((c) => c.seq > after).slice(0, limit);
    return Response.json({ changes: page, last: page.at(-1)?.seq ?? after, next: page.length === limit ? page.at(-1)!.seq : null });
  }) as typeof fetch;
}

describe('the agent copy of the published records (ADR 10)', () => {
  it('starts from the first change, then asks only for what changed since, and drops removed records', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'scms-copy-')), 'published.json');
    const changes: Change[] = Array.from({ length: 150 }, (_, i) => ({ object: 'article', id: `a${i}`, seq: i + 1, record: { id: `a${i}`, title: `T${i}` } }));
    const seen: string[] = [];
    const first = await syncCopy('https://app.test', path, feed(changes, seen));
    expect(Object.keys(first!.objects['article']!)).toHaveLength(150);
    expect(seen).toEqual(['?after=0&limit=100', '?after=100&limit=100']);

    changes.push({ object: 'article', id: 'a3', seq: 151, record: null }, { object: 'article', id: 'a4', seq: 152, record: { id: 'a4', title: 'changed' } });
    seen.length = 0;
    const second = await syncCopy('https://app.test', path, feed(changes, seen));
    expect(seen).toEqual(['?after=150&limit=100']);
    expect(second!.objects['article']!['a3']).toBeUndefined();
    expect(second!.objects['article']!['a4']).toEqual({ id: 'a4', title: 'changed' });
    expect(JSON.parse(readFileSync(path, 'utf8')).seq).toBe(152);
  });

  it('starts over for another app, and gives up quietly on an app with no feed', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'scms-copy-')), 'published.json');
    const seen: string[] = [];
    await syncCopy('https://one.test', path, feed([{ object: 'a', id: '1', seq: 5, record: { id: '1' } }], seen));
    seen.length = 0;
    await syncCopy('https://two.test', path, feed([], seen));
    expect(seen).toEqual(['?after=0&limit=100']);
    expect(await syncCopy('https://old.test', path, (async () => new Response('', { status: 404 })) as typeof fetch)).toBeNull();
  });
});
