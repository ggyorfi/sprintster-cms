import { describe, expect, it } from 'vitest';
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

const page = {
  name: 'page',
  title: 'Page',
  titlePlural: 'Pages',
  route: 'pages',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'title', type: 'text' },
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

async function setup(pluginConfig: Record<string, unknown> = {}) {
  const config = loadConfig({ version: '1', objects: [page, settings, ...contributedObjects] });
  setAppConfig(config);
  const store = new InMemoryEventStore();
  const apis = Object.fromEntries(config.objects.map((o) => [o.name, createObjectApi<{ id: string }>(store, o)])) as Record<string, PluginObjectApi<{ id: string }>>;
  const routes: PluginRoute[] = [];
  const pushed: unknown[] = [];
  const gui: Array<{ id: string; placement?: string }> = [];
  const ctx = {
    config: pluginConfig,
    logger: { info() {}, warn() {}, error() {} },
    objects: { register() {} },
    routes: { register: (r: PluginRoute) => routes.push(r) },
    channels: { open: () => ({ send: (m: unknown) => pushed.push(m) }) },
    gui: { action: (a: { id: string }) => gui.push(a), badge: (b: { id: string }) => gui.push(b) },
    data: { object: (name: string) => apis[name]!, position: () => store.position(), changesSince: (p: number) => changesSince(store, p) },
  } as unknown as DaemonPluginContext;
  await plugin.init(ctx);
  const call = async (method: string, path: string, body?: unknown) => {
    const route = routes.find((r) => r.method === method && new RegExp(`^${r.path.replace(/:\w+/g, '[^/]+')}$`).test(path))!;
    const params = Object.fromEntries((route.path.match(/:\w+/g) ?? []).map((k) => [k.slice(1), path.split('/')[route.path.split('/').indexOf(k)]!]));
    const res = await route.handler(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), params);
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, any>) };
  };
  const addPage = (title: string) => apis['page']!.add!({ id: crypto.randomUUID(), title });
  return { call, addPage, pushed, gui };
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

  it('runs a request through claim and done, and counts changes since the published position', async () => {
    const { call, addPage, pushed } = await setup();
    await addPage('Home');
    expect((await call('GET', '/status')).body).toEqual({ text: 'Not published yet', tone: 'warning' });

    expect((await call('POST', '/requests')).status).toBe(201);
    expect((await call('POST', '/requests')).body!['message']).toBe('A publish is already queued.');
    expect(pushed).toEqual([{ type: 'job' }]);
    expect((await call('GET', '/status')).body!['text']).toBe('Publish queued');

    const claimed = await call('POST', '/jobs/claim');
    expect(claimed.body!['job']).toMatchObject({ status: 'building', position: expect.any(Number) });
    expect((await call('POST', '/jobs/claim')).status).toBe(204);

    await call('POST', `/jobs/${claimed.body!['job'].id}/done`, { ok: true });
    expect((await call('GET', '/status')).body).toEqual({ text: 'Published', tone: 'success' });

    await addPage('About');
    await addPage('Contact');
    expect((await call('GET', '/status')).body).toEqual({ text: '2 unpublished changes', tone: 'warning' });
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
