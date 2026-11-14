import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryEventStore,
  changesSince,
  createObjectApi,
  loadConfig,
  setAppConfig,
  type DaemonPluginContext,
  type PluginObjectApi,
  type PluginRoute,
} from 'sprintster';
import { contributedObjects, plugin } from './plugin.js';

const tag = {
  name: 'tag',
  title: 'Tag',
  titlePlural: 'Tags',
  route: 'tags',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'title', type: 'text' },
    { name: 'removed', type: 'boolean', system: true },
  ],
};

const page = {
  name: 'page',
  title: 'Page',
  titlePlural: 'Pages',
  route: 'pages',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'title', type: 'text' },
    { name: 'tags', type: 'refs', target: 'tag', nullable: true },
    { name: 'removed', type: 'boolean', system: true },
  ],
};

const settings = {
  name: 'settings',
  title: 'Settings',
  titlePlural: 'Settings',
  route: 'settings',
  singleton: true,
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'maintenance', type: 'boolean' },
  ],
  lists: [],
  views: [{ name: 'default', title: 'Settings', fields: [{ property: 'maintenance' }] }],
};

async function setup(pluginConfig: Record<string, unknown> = {}, log: InMemoryEventStore | null = null) {
  const config = loadConfig({ version: '1', title: 'Test site', objects: [tag, page, settings, ...contributedObjects] });
  setAppConfig(config);
  const store = new InMemoryEventStore();
  // Another store's log, as s8r import appends it: events only, no published set.
  for (const e of log === null ? [] : await log.findSince(0)) await store.append(e);
  const apis: Record<string, PluginObjectApi<{ id: string }>> = {};
  for (const o of config.objects) apis[o.name] = createObjectApi<{ id: string }>(store, o, { resolveTarget: (name) => apis[name] });
  const routes: PluginRoute[] = [];
  const pushed: unknown[] = [];
  const gui: Array<{ id: string; placement?: string }> = [];
  const columns: Array<{ id: string; values(object: string, ids: string[]): Promise<Record<string, { text: string }>> }> = [];
  const ctx = {
    config: pluginConfig,
    app: config,
    logger: { info() {}, warn() {}, error() {} },
    objects: { register() {} },
    routes: { register: (r: PluginRoute) => routes.push(r) },
    channels: { open: () => ({ send: (m: unknown) => pushed.push(m) }) },
    gui: { action: (a: { id: string }) => gui.push(a), badge: (b: { id: string }) => gui.push(b), column: (c: { id: string }) => columns.push(c) },
    data: {
      object: (name: string) => apis[name]!,
      position: () => store.position(),
      changesSince: (p: number) => changesSince(store, p),
      pinnedSince: (set: string, after: number, limit: number) => store.states.pins.since(set, 0, after, limit),
    },
  } as unknown as DaemonPluginContext;
  await plugin.init(ctx);
  const call = async (method: string, path: string, body?: unknown) => {
    const bare = path.split('?')[0]!;
    const route = routes.find((r) => r.method === method && new RegExp(`^${r.path.replace(/:\w+/g, '[^/]+')}$`).test(bare))!;
    const params = Object.fromEntries((route.path.match(/:\w+/g) ?? []).map((k) => [k.slice(1), bare.split('/')[route.path.split('/').indexOf(k)]!]));
    const res = await route.handler(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), params);
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, any>) };
  };
  const addPage = (title: string, tags: string[] | null = null) => apis['page']!.add!({ id: crypto.randomUUID(), title, tags });
  const titles = async () => ((await call('GET', '/records/page')).body!['rows'] as Array<{ title: string }>).map((r) => r.title).sort();
  const badge = async (id: string, object = 'page') => (await call('GET', `/records/status?object=${object}&id=${id}`)).body!['text'];
  const pages = async () => (await call('GET', '/records/page')).body!['rows'] as Array<{ id: string; title: string; publishedAt: string; lastPublishedAt: string }>;
  return { call, addPage, pushed, gui, columns, apis, store, titles, badge, pages };
}

async function claimAndFinish(call: (method: string, path: string, body?: unknown) => Promise<{ body: Record<string, any> | null }>) {
  const { body } = await call('POST', '/jobs/claim');
  await call('POST', `/jobs/${body!['job'].id}/done`, { ok: true });
}

describe('publish plugin', () => {
  it('switches maintenance mode from the Maintenance page and publishes each change', async () => {
    const { call, gui, pushed } = await setup({ maintenance: 'settings.maintenance' });
    expect(gui.filter((g) => g.id === 'maintenance').map((g) => g.placement)).toEqual(['maintenance', 'maintenance']);
    expect((await call('GET', '/maintenance')).body).toEqual({ text: 'Site online', tone: 'success' });
    expect((await call('POST', '/maintenance')).body!['message']).toBe('The site goes offline with this publish.');
    expect((await call('GET', '/maintenance')).body).toEqual({ text: 'Site offline (maintenance)', tone: 'warning' });
    expect((await call('POST', '/maintenance')).body!['message']).toBe('The site comes back online with the publish already queued.');
    expect((await call('GET', '/maintenance')).body!['text']).toBe('Site online');
    expect(pushed).toHaveLength(1);
  });

  it('offers no switch unless configured', async () => {
    const { gui } = await setup();
    expect(gui.map((g) => g.id)).not.toContain('maintenance');
  });

  it('runs a request through claim and done', async () => {
    const { call, pushed } = await setup();
    expect((await call('POST', '/requests')).status).toBe(201);
    expect((await call('POST', '/requests')).body!['message']).toBe('A publish is already queued.');
    expect(pushed).toEqual([{ type: 'job' }]);
    expect((await call('GET', '/status')).body!['text']).toBe('Publish queued');
    const claimed = await call('POST', '/jobs/claim');
    expect(claimed.body!['job']).toMatchObject({ status: 'building' });
    expect((await call('POST', '/jobs/claim')).status).toBe(204);
    await call('POST', `/jobs/${claimed.body!['job'].id}/done`, { ok: true });
    expect((await call('GET', '/status')).body!['text']).toBe('Not published yet');
  });

  it('publishes everything with Publish all, and counts the records changed since', async () => {
    const { call, addPage, titles } = await setup();
    await addPage('Home');
    await call('POST', '/all');
    await claimAndFinish(call);
    expect((await call('GET', '/status')).body).toEqual({ text: 'Published', tone: 'success' });
    await addPage('About');
    await addPage('Contact');
    expect((await call('GET', '/status')).body).toEqual({ text: '2 pending', tone: 'danger' });
    expect(await titles()).toEqual(['Home']);
  });

  it('publishes one record without another editor\'s pending edit (ADR 7)', async () => {
    const { call, addPage, apis, titles, badge } = await setup();
    const a = await addPage('A');
    const b = await addPage('B');
    await call('POST', '/all');
    await apis['page']!.update!(a.id, { title: 'A, half done' });
    await apis['page']!.update!(b.id, { title: 'B, finished' });
    expect(await badge(b.id)).toBe('Pending');
    const res = await call('POST', '/records/publish', { object: 'page', id: b.id });
    expect(res.body!['message']).toMatch(/^Published\./);
    expect(await titles()).toEqual(['A', 'B, finished']);
    expect(await badge(a.id)).toBe('Pending');
    expect(await badge(b.id)).toBe('Published');
  });

  it('keeps a new record off the site until it is published, then publishes the new records it points at', async () => {
    const { call, addPage, apis, titles, badge } = await setup();
    await call('POST', '/all');
    const t = await apis['tag']!.add!({ id: crypto.randomUUID(), title: 'news' });
    const p = await addPage('Fresh', [t.id]);
    expect(await badge(p.id)).toBe('Pending');
    expect(await titles()).toEqual([]);
    const res = await call('POST', '/records/publish', { object: 'page', id: p.id });
    expect(res.body!['message']).toContain(`tag ${t.id}`);
    expect(await titles()).toEqual(['Fresh']);
    expect(await badge(t.id, 'tag')).toBe('Published');
  });

  it('leaves a published record that is pointed at alone, pending edits and all', async () => {
    const { call, addPage, apis } = await setup();
    const t = await apis['tag']!.add!({ id: crypto.randomUUID(), title: 'news' });
    await call('POST', '/all');
    await apis['tag']!.update!(t.id, { title: 'renamed, not ready' });
    const p = await addPage('Fresh', [t.id]);
    await call('POST', '/records/publish', { object: 'page', id: p.id });
    const tags = (await call('GET', '/records/tag')).body!['rows'] as Array<{ title: string }>;
    expect(tags.map((x) => x.title)).toEqual(['news']);
  });

  it('keeps a site built before per-record publishing as it was (its last build is the baseline)', async () => {
    const { call, addPage, apis, store, titles } = await setup();
    await addPage('Old');
    const job = await apis['publishJob']!.add!({ id: crypto.randomUUID(), status: 'requested', requestedAt: '2026-01-01T00:00:00Z' });
    await apis['publishJob']!.update!(job.id, { status: 'published', position: await store.position() });
    await addPage('Newer');
    expect(await titles()).toEqual(['Old']);
    expect((await call('GET', '/status')).body!['text']).toBe('1 pending');
  });

  it('refuses to publish the plugin\'s own records or an unknown object', async () => {
    const { call } = await setup();
    expect((await call('POST', '/records/publish', { object: 'publishJob', id: 'x' })).status).toBe(400);
    expect((await call('GET', '/records/nothing')).status).toBe(404);
  });

  it('offers Publish on each content record and Publish all with a warning', async () => {
    const { gui } = await setup();
    const record = gui.filter((g) => g.placement === 'record') as Array<{ id: string; objects?: string[] }>;
    expect(record.map((g) => g.id)).toEqual(['record', 'record']);
    expect(record[0]!.objects).toEqual(['tag', 'page', 'settings']);
    expect((gui.find((g) => g.id === 'publish') as { confirm?: string }).confirm).toMatch(/other editors/);
  });

  it('reports a failed publish until the next one', async () => {
    const { call } = await setup();
    await call('POST', '/requests');
    const { body } = await call('POST', '/jobs/claim');
    await call('POST', `/jobs/${body!['job'].id}/done`, { ok: false, message: 'wrangler exited 1' });
    expect((await call('GET', '/status')).body).toEqual({ text: 'Publish failed: wrangler exited 1', tone: 'danger' });
  });

  it('rejects a malformed result', async () => {
    const { call } = await setup();
    expect((await call('POST', '/jobs/x/done', { done: 'yes' })).status).toBe(400);
  });
});

describe('publication states and scheduling (ADR 9)', () => {
  afterEach(() => vi.useRealTimers());
  const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  it('schedules a record: yellow until its date, live after it, with the date as its first publish', async () => {
    const { call, addPage, badge, titles, pages } = await setup();
    await call('POST', '/all');
    const p = await addPage('Friday');
    const when = future(60);
    expect((await call('POST', '/records/publish', { object: 'page', id: p.id, value: when })).body!['message']).toMatch(/^Scheduled/);
    expect(await badge(p.id)).toBe('Scheduled');
    expect(await titles()).toEqual([]);
    expect((await call('GET', '/schedule')).body!['dates']).toEqual([when]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(when) + 1000);
    expect(await badge(p.id)).toBe('Published');
    expect(await pages()).toEqual([]);
    await call('POST', '/requests');
    await call('POST', '/jobs/claim');
    expect((await pages()).map((r) => [r.title, r.publishedAt])).toEqual([['Friday', when]]);
  });

  it('drops a schedule when the record is edited, making it pending again', async () => {
    const { call, addPage, apis, badge } = await setup();
    await call('POST', '/all');
    const p = await addPage('Friday');
    await call('POST', '/records/publish', { object: 'page', id: p.id, value: future(60) });
    await apis['page']!.update!(p.id, { title: 'Friday, changed' });
    expect(await badge(p.id)).toBe('Pending');
    expect((await call('GET', '/schedule')).body!['dates']).toEqual([]);
  });

  it('keeps the first publish date when a record is published again', async () => {
    const { call, addPage, apis, pages } = await setup();
    await call('POST', '/all');
    const p = await addPage('Old news');
    await call('POST', '/records/publish', { object: 'page', id: p.id, value: null });
    const first = (await pages())[0]!.publishedAt;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3_600_000);
    await apis['page']!.update!(p.id, { title: 'Old news, corrected' });
    await call('POST', '/records/publish', { object: 'page', id: p.id, value: null });
    const [row] = await pages();
    expect(row!.publishedAt).toBe(first);
    expect(row!.lastPublishedAt > first).toBe(true);
  });

  it('refuses a date in the past', async () => {
    const { call, addPage } = await setup();
    const p = await addPage('Late');
    expect((await call('POST', '/records/publish', { object: 'page', id: p.id, value: '2001-01-01T00:00:00Z' })).status).toBe(400);
  });

  it('colours each row by its state in the list column', async () => {
    const { call, addPage, columns } = await setup();
    const a = await addPage('Live');
    await call('POST', '/all');
    const b = await addPage('New');
    const values = await columns.find((c) => c.id === 'state')!.values('page', [a.id, b.id]);
    expect([values[a.id], values[b.id]]).toEqual([{ text: 'Published', tone: 'success' }, { text: 'Pending', tone: 'danger' }]);
  });
});

describe('the published set and its change feed (ADR 10)', () => {
  it('feeds publishes and published deletes in order, with publish dates, page by page', async () => {
    const { call, addPage, apis } = await setup();
    const a = await addPage('A');
    const b = await addPage('B');
    await call('POST', '/all');
    const first = (await call('GET', '/changes?after=0&limit=1')).body!;
    expect(first['changes']).toHaveLength(1);
    expect(first['next']).not.toBeNull();
    const all = (await call('GET', '/changes?after=0')).body!;
    expect(all['changes'].map((c: { id: string }) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(all['changes'][0].record.publishedAt).toEqual(expect.any(String));
    await apis['page']!.remove!(a.id);
    await call('POST', '/records/publish', { object: 'page', id: a.id });
    const after = (await call('GET', `/changes?after=${all['last']}`)).body!;
    expect(after['changes']).toEqual([expect.objectContaining({ id: a.id, record: null })]);
  });

  it('never publishes a private object', async () => {
    const { call, apis } = await setup({ private: ['tag'] });
    const t = await apis['tag']!.add!({ id: crypto.randomUUID(), title: 'secret' });
    expect((await call('POST', '/records/publish', { object: 'tag', id: t.id })).status).toBe(400);
    await call('POST', '/all');
    expect(((await call('GET', '/changes?after=0')).body!['changes'] as Array<{ object: string }>).some((c) => c.object === 'tag')).toBe(false);
    expect((await call('GET', '/records/tag')).status).toBe(404);
  });

  it('pages the published records and refuses a bad query', async () => {
    const { call, addPage } = await setup();
    for (const t of ['A', 'B', 'C']) await addPage(t);
    await call('POST', '/all');
    const page = (await call('GET', '/records/page?limit=2&sort=title')).body!;
    expect(page['rows'].map((r: { title: string }) => r.title)).toEqual(['A', 'B']);
    const rest = (await call('GET', `/records/page?limit=2&sort=title&after=${page['next']}`)).body!;
    expect(rest['rows'].map((r: { title: string }) => r.title)).toEqual(['C']);
    expect((await call('GET', '/records/page?limit=500')).status).toBe(400);
    expect((await call('GET', '/changes?limit=0')).status).toBe(400);
  });

  it('builds the set once for a site published before it, keeping its published versions', async () => {
    const { call, addPage, apis, store } = await setup();
    const old = await addPage('Old');
    const job = await apis['publishJob']!.add!({ id: crypto.randomUUID(), status: 'requested', requestedAt: '2026-01-01T00:00:00Z' });
    await apis['publishJob']!.update!(job.id, { status: 'published', position: await store.position() });
    await apis['page']!.update!(old.id, { title: 'Old, edited later' });
    await addPage('Newer');
    const rows = (await call('GET', '/records/page')).body!['rows'] as Array<{ title: string }>;
    expect(rows.map((r) => r.title)).toEqual(['Old']);
  });

  it('builds the set again for a log moved to another store without it (ADR 12)', async () => {
    const before = await setup();
    await before.addPage('Live');
    await before.call('POST', '/all');
    await before.addPage('Draft');
    const moved = await setup({}, before.store);
    expect(await moved.titles()).toEqual(['Live']);
  });

  it('rebuilds the set and queues a build only when the request names the app (ADR 12)', async () => {
    const { call, addPage, pushed } = await setup();
    await addPage('Live');
    await call('POST', '/all');
    await claimAndFinish(call);
    expect((await call('POST', '/rebuild')).status).toBe(400);
    expect((await call('POST', '/rebuild', { confirm: 'rebuild' })).status).toBe(400);
    const sent = pushed.length;
    const done = await call('POST', '/rebuild', { confirm: 'Test site' });
    expect(done.status).toBe(200);
    expect(pushed.length).toBe(sent + 1);
    const { changes } = (await call('GET', '/changes?after=0')).body as { changes: Array<{ record: { title: string } | null }> };
    expect(changes.map((c) => c.record?.title)).toContain('Live');
  });
});
