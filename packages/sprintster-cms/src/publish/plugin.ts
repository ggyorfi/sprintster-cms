import { eventTypeNames, type Config, type DaemonPlugin, type PluginData } from 'sprintster';
import { z } from 'zod';

export const JOB_OBJECT = 'publishJob';
// ADR 7: the log position each record is published at; the row with object '*' is the baseline every record is published at.
export const PUBLICATION_OBJECT = 'publication';
const BASELINE = '*';
const ACTOR_HEADER = 'sprintster-actor';

type Status = 'requested' | 'building' | 'published' | 'failed';

export interface PublishJob {
  id: string;
  status: Status;
  position: number | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

// Stored in the app's own log, so a request survives restarts and the history shows in the admin.
export const contributedObjects = [
  {
    name: JOB_OBJECT,
    title: 'Publish',
    titlePlural: 'Publishing',
    route: 'publish-jobs',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'status', title: 'Status', type: 'enum', values: ['requested', 'building', 'published', 'failed'], default: 'requested' },
      { name: 'position', title: 'Log position', type: 'integer', nullable: true },
      { name: 'requestedAt', title: 'Requested', type: 'datetime' },
      { name: 'startedAt', title: 'Started', type: 'datetime', nullable: true },
      { name: 'finishedAt', title: 'Finished', type: 'datetime', nullable: true },
      { name: 'message', title: 'Message', type: 'text', nullable: true },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [
      {
        name: 'default',
        title: 'Publishing',
        columns: [
          { property: 'requestedAt', label: 'Requested', width: 20 },
          { property: 'status', label: 'Status', width: 12 },
          { property: 'finishedAt', label: 'Finished', width: 20 },
          { property: 'message', label: 'Message', width: 40 },
        ],
      },
    ],
    views: [
      {
        name: 'default',
        title: 'Publish',
        fields: [{ property: 'status' }, { property: 'requestedAt' }, { property: 'startedAt' }, { property: 'finishedAt' }, { property: 'message', rows: 4 }],
      },
    ],
  },
  {
    name: PUBLICATION_OBJECT,
    title: 'Publication',
    titlePlural: 'Publications',
    route: 'publications',
    hidden: true,
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'object', title: 'Object', type: 'text' },
      { name: 'record', title: 'Record', type: 'text' },
      { name: 'position', title: 'Log position', type: 'integer' },
      { name: 'publishedAt', title: 'First published', type: 'datetime', nullable: true },
      { name: 'lastPublishedAt', title: 'Last published', type: 'datetime', nullable: true },
      { name: 'scheduledAt', title: 'Scheduled for', type: 'datetime', nullable: true },
      { name: 'scheduledPosition', title: 'Scheduled position', type: 'integer', nullable: true },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [
      {
        name: 'default',
        title: 'Publications',
        columns: [
          { property: 'object', label: 'Object', width: 20 },
          { property: 'record', label: 'Record', width: 40 },
          { property: 'position', label: 'Position', width: 10 },
        ],
      },
    ],
    views: [{ name: 'default', title: 'Publication', fields: [{ property: 'object' }, { property: 'record' }, { property: 'position' }] }],
  },
];

const OWN_OBJECTS = new Set([JOB_OBJECT, PUBLICATION_OBJECT]);

interface PublicationRow {
  id: string;
  object: string;
  record: string;
  position: number;
  publishedAt?: string | null;
  lastPublishedAt?: string | null;
  scheduledAt?: string | null;
  scheduledPosition?: number | null;
}

const keyOf = (object: string, id: string) => `${object}\u0000${id}`;
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const byTime = (a: PublishJob, b: PublishJob) => a.requestedAt.localeCompare(b.requestedAt);

// What is published: the baseline, each record's own row, and, for records changed since the baseline, when they
// were created (null when before the baseline) and their latest change.
export interface Published {
  baseline: number;
  rows: Map<string, PublicationRow>;
  changed: Map<string, { object: string; id: string; created: number | null; head: number }>;
  at: number;
}

// A site built before ADR 7 was published as a whole at its last build's position, so that is its baseline until the first Publish all.
async function legacyBaseline(data: PluginData): Promise<number> {
  const built = (await jobs(data)).filter((j) => j.status === 'published' && typeof j.position === 'number');
  return Math.max(0, ...built.map((j) => j.position as number));
}

export async function published(data: PluginData, at: number = Date.now()): Promise<Published> {
  const rows = new Map<string, PublicationRow>();
  let baselineRow: PublicationRow | undefined;
  for (const r of (await data.object(PUBLICATION_OBJECT).list()) as unknown as PublicationRow[]) {
    if (r.object === BASELINE) baselineRow = r;
    else rows.set(keyOf(r.object, r.record), r);
  }
  const baseline = baselineRow?.position ?? (await legacyBaseline(data));
  const changed: Published['changed'] = new Map();
  for (const c of await data.changesSince(baseline)) {
    if (OWN_OBJECTS.has(c.object)) continue;
    const key = keyOf(c.object, c.id);
    const seen = changed.get(key);
    const created = c.event === eventTypeNames(c.object).added ? c.position : null;
    if (seen === undefined) changed.set(key, { object: c.object, id: c.id, created, head: c.position });
    else seen.head = Math.max(seen.head, c.position);
  }
  return { baseline, rows, changed, at };
}

// ADR 9: a schedule holds while nothing changed after the position it was made at; any edit voids it.
function schedule(p: Published, object: string, id: string): { at: string; position: number; due: boolean } | null {
  const row = p.rows.get(keyOf(object, id));
  if (row?.scheduledAt == null || row.scheduledPosition == null) return null;
  const head = p.changed.get(keyOf(object, id))?.head;
  if (head !== undefined && head > row.scheduledPosition) return null;
  return { at: row.scheduledAt, position: row.scheduledPosition, due: Date.parse(row.scheduledAt) <= p.at };
}

export function positionOf(p: Published, object: string, id: string): number {
  const s = schedule(p, object, id);
  return Math.max(p.rows.get(keyOf(object, id))?.position ?? 0, p.baseline, s?.due === true ? s.position : 0);
}

export type RecordState = 'published' | 'scheduled' | 'pending';

export function recordState(p: Published, object: string, id: string): RecordState {
  const s = schedule(p, object, id);
  if (s !== null && !s.due) return 'scheduled';
  const c = p.changed.get(keyOf(object, id));
  if (c === undefined) return 'published';
  const at = positionOf(p, object, id);
  if (c.created !== null && c.created > at) return 'pending';
  return c.head > at ? 'pending' : 'published';
}

// ADR 9: the first and the latest time the record went live; older records fall back to their own publishedAt, then createdAt.
export function datesOf(p: Published, object: string, record: Record<string, unknown>): { publishedAt: string | null; lastPublishedAt: string | null } {
  const id = String(record['id']);
  const row = p.rows.get(keyOf(object, id));
  const s = schedule(p, object, id);
  const went = s?.due === true ? s.at : null;
  const own = typeof record['publishedAt'] === 'string' ? record['publishedAt'] : typeof record['createdAt'] === 'string' ? record['createdAt'] : null;
  const publishedAt = row?.publishedAt ?? went ?? own;
  const latest = [row?.lastPublishedAt, went].filter((d): d is string => typeof d === 'string').sort().at(-1);
  return { publishedAt, lastPublishedAt: latest ?? publishedAt };
}

const STATES: Record<RecordState, { text: string; tone: 'success' | 'warning' | 'danger' }> = {
  published: { text: 'Published', tone: 'success' },
  scheduled: { text: 'Scheduled', tone: 'warning' },
  pending: { text: 'Pending', tone: 'danger' },
};

function stateValue(p: Published, object: string, id: string): { text: string; tone: 'success' | 'warning' | 'danger' } {
  const state = recordState(p, object, id);
  if (state !== 'scheduled') return STATES[state];
  return { ...STATES.scheduled, text: `Scheduled ${schedule(p, object, id)!.at.slice(0, 16).replace('T', ' ')}` };
}

const ASSET_LINK = /\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

// The records a record points at: its ref and refs values, and the asset records its text links to (core ADR 10).
function referencesOf(app: Config, object: string, record: Record<string, unknown>): Array<{ object: string; id: string }> {
  const obj = app.objects.find((o) => o.name === object);
  if (obj === undefined) return [];
  const out: Array<{ object: string; id: string }> = [];
  for (const p of obj.properties) {
    const value = record[p.name];
    if (p.type === 'ref' && typeof value === 'string') out.push({ object: p.target, id: value });
    if (p.type === 'refs' && Array.isArray(value)) for (const v of value) if (typeof v === 'string') out.push({ object: p.target, id: v });
    if ((p.type === 'markdown' || p.type === 'text') && app.assets !== undefined && value !== null && value !== undefined) {
      for (const m of JSON.stringify(value).matchAll(ASSET_LINK)) out.push({ object: app.assets, id: m[1] as string });
    }
  }
  return out;
}

async function jobs(data: PluginData): Promise<PublishJob[]> {
  return ((await data.object(JOB_OBJECT).list()) as unknown as Array<PublishJob & { removed?: boolean }>)
    .filter((j) => j.removed !== true)
    .sort(byTime);
}

export async function status(data: PluginData): Promise<{ text: string; tone: 'info' | 'warning' | 'success' | 'danger' }> {
  const all = await jobs(data);
  const active = all.find((j) => j.status === 'requested' || j.status === 'building');
  if (active !== undefined) return { text: active.status === 'building' ? 'Publishing…' : 'Publish queued', tone: 'info' };
  const last = all.at(-1);
  if (last?.status === 'failed') return { text: `Publish failed: ${last.message ?? 'see Publishing'}`, tone: 'danger' };
  const p = await published(data);
  if (p.baseline === 0 && p.rows.size === 0) return { text: 'Not published yet', tone: 'warning' };
  const states = [...p.changed.values()].map((c) => recordState(p, c.object, c.id));
  const pending = states.filter((s) => s === 'pending').length;
  const scheduled = [...p.rows.values()].filter((r) => recordState(p, r.object, r.record) === 'scheduled').length;
  const parts = [pending > 0 ? `${pending} pending` : null, scheduled > 0 ? `${scheduled} scheduled` : null].filter(Boolean);
  if (parts.length === 0) return { text: 'Published', tone: 'success' };
  return { text: parts.join(', '), tone: pending > 0 ? 'danger' : 'warning' };
}

const Done = z.object({ ok: z.boolean(), message: z.string().optional() });
const PublishRequest = z.object({ object: z.string().min(1), id: z.string().min(1), value: z.string().nullable().optional() });

// `maintenance`: the same `<singleton>.<boolean>` as scms.config.json's; with it, the Maintenance page gets the switch.
const Config = z.object({ maintenance: z.string().regex(/^\w+\.\w+$/, 'must be <singleton>.<boolean property>').optional() }).strict();

export const plugin: DaemonPlugin = {
  name: 'sprintster-cms/publish',
  namespace: 'publish',
  version: '1',
  capabilities: [],
  config: Config,
  init(ctx) {
    const app = ctx.app;
    const api = () => ctx.data.object(JOB_OBJECT);
    const publications = () => ctx.data.object(PUBLICATION_OBJECT);
    const actorOf = (request: Request) => request.headers.get(ACTOR_HEADER) ?? undefined;
    const publishable = (object: string) => !OWN_OBJECTS.has(object) && app.objects.some((o) => o.name === object);

    async function writeRow(p: Published, object: string, record: string, patch: Partial<PublicationRow>, actor: string | undefined): Promise<void> {
      const row = p.rows.get(keyOf(object, record));
      if (row === undefined) {
        const added = { id: crypto.randomUUID(), object, record, position: 0, ...patch };
        await publications().add!(added, actor);
        p.rows.set(keyOf(object, record), added as PublicationRow);
      } else {
        await publications().update!(row.id, patch, actor);
        Object.assign(row, patch);
      }
    }

    // ADR 9: live now. A record never published before goes live for the first time now (or at its own imported date).
    async function publishNow(p: Published, object: string, id: string, position: number, actor: string | undefined): Promise<void> {
      const record = (await ctx.data.object(object).get(id)) as Record<string, unknown> | null;
      if (record === null) return;
      const at = now();
      const c = p.changed.get(keyOf(object, id));
      const first = c?.created != null && c.created > positionOf(p, object, id);
      const own = typeof record['publishedAt'] === 'string' ? record['publishedAt'] : null;
      const publishedAt = first ? (own ?? at) : (datesOf(p, object, record).publishedAt ?? at);
      await writeRow(p, object, id, { position, publishedAt, lastPublishedAt: at, scheduledAt: null, scheduledPosition: null }, actor);
    }

    // ADR 7 and 9: the record, and every record it points at that was never published, transitively, now or on a date.
    async function publishRecord(object: string, id: string, when: string | null, actor: string | undefined): Promise<string[]> {
      const position = await ctx.data.position();
      const p = await published(ctx.data);
      const also: string[] = [];
      const seen = new Set<string>();
      const visit = async (o: string, i: string, root: boolean): Promise<void> => {
        if (seen.has(keyOf(o, i))) return;
        seen.add(keyOf(o, i));
        const c = p.changed.get(keyOf(o, i));
        const neverPublished = c?.created != null && c.created > positionOf(p, o, i);
        if (!root && !neverPublished) return;
        const record = (await ctx.data.object(o).get(i)) as Record<string, unknown> | null;
        if (record === null) return;
        if (when === null) await publishNow(p, o, i, position, actor);
        else await writeRow(p, o, i, { scheduledAt: when, scheduledPosition: position }, actor);
        if (!root) also.push(`${o} ${i}`);
        for (const r of referencesOf(app, o, record)) await visit(r.object, r.id, false);
      };
      await visit(object, id, true);
      return also;
    }

    // Agents listen here and claim over HTTP when told; a push carries no job, so a missed one costs nothing.
    const agents = ctx.channels.open('jobs');

    async function requestPublish(): Promise<{ queued: boolean; job: PublishJob }> {
      const active = (await jobs(ctx.data)).find((j) => j.status === 'requested' || j.status === 'building');
      if (active !== undefined) return { queued: false, job: active };
      const job = (await api().add!({ id: crypto.randomUUID(), status: 'requested', requestedAt: now() })) as unknown as PublishJob;
      agents.send({ type: 'job' });
      return { queued: true, job };
    }

    const updates = (queued: boolean) => `The site updates with ${queued ? 'this publish' : 'the publish already queued'}.`;

    ctx.routes.register({
      method: 'POST',
      path: '/records/publish',
      handler: async (request) => {
        const parsed = PublishRequest.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ code: 'bad_request', message: 'expected { object, id, value? }' }, { status: 400 });
        const { object, id } = parsed.data;
        const when = parsed.data.value ?? null;
        if (!publishable(object)) return Response.json({ code: 'bad_request', message: `'${object}' is not published` }, { status: 400 });
        if (when !== null && !(Date.parse(when) > Date.now())) return Response.json({ code: 'bad_request', message: 'Pick a date in the future, or leave it empty to publish now.' }, { status: 400 });
        const also = await publishRecord(object, id, when === null ? null : new Date(when).toISOString().replace(/\.\d{3}Z$/, 'Z'), actorOf(request));
        const pointed = also.length === 0 ? '' : ` Also ${when === null ? 'published' : 'scheduled'} what it points at: ${also.join(', ')}.`;
        if (when !== null) {
          agents.send({ type: 'schedule' });
          return Response.json({ message: `Scheduled for ${when}.${pointed}` });
        }
        const { queued } = await requestPublish();
        return Response.json({ message: `Published.${pointed} ${updates(queued)}` });
      },
    });

    ctx.routes.register({
      method: 'GET',
      path: '/records/status',
      handler: async (request) => {
        const url = new URL(request.url);
        return Response.json(stateValue(await published(ctx.data), url.searchParams.get('object') ?? '', url.searchParams.get('id') ?? ''));
      },
    });

    // Every record of an object as published, with its publish dates: what a build renders (ADR 7, 9).
    ctx.routes.register({
      method: 'GET',
      path: '/records/:object',
      handler: async (_request, params) => {
        const object = params['object'] ?? '';
        if (!publishable(object)) return Response.json({ code: 'not_found', message: `no object '${object}'` }, { status: 404 });
        const p = await published(ctx.data);
        const positions: Record<string, number> = {};
        for (const r of p.rows.values()) if (r.object === object) positions[r.record] = positionOf(p, object, r.record);
        const listAt = ctx.data.object(object).listAt;
        const records = (listAt === undefined ? await ctx.data.object(object).list() : await listAt({ position: p.baseline, positions })) as Array<Record<string, unknown>>;
        return Response.json(records.map((r) => ({ ...r, ...datesOf(p, object, r) })));
      },
    });

    // ADR 9: the agent's timer: every schedule still holding, and when the last successful build started.
    ctx.routes.register({
      method: 'GET',
      path: '/schedule',
      handler: async () => {
        const p = await published(ctx.data);
        const dates = [...p.rows.values()].flatMap((r) => {
          const s = schedule(p, r.object, r.record);
          return s === null ? [] : [s.at];
        });
        const starts = (await jobs(ctx.data)).filter((j) => j.status === 'published' && j.startedAt !== null).map((j) => j.startedAt as string);
        return Response.json({ dates, lastBuilt: starts.sort().at(-1) ?? null });
      },
    });

    ctx.routes.register({
      method: 'POST',
      path: '/all',
      handler: async (request) => {
        const actor = actorOf(request);
        const position = await ctx.data.position();
        const p = await published(ctx.data);
        const waiting = [...new Set([...p.changed.values(), ...[...p.rows.values()].map((r) => ({ object: r.object, id: r.record }))].map((c) => keyOf(c.object, c.id)))]
          .map((k) => k.split('\u0000') as [string, string])
          .filter(([o, i]) => publishable(o) && recordState(p, o, i) !== 'published');
        for (const [o, i] of waiting) await publishNow(p, o, i, position, actor);
        await writeRow(p, BASELINE, BASELINE, { position }, actor);
        const { queued } = await requestPublish();
        return Response.json({ message: `Everything is published. ${updates(queued)}` });
      },
    });

    ctx.routes.register({
      method: 'POST',
      path: '/requests',
      handler: async () => {
        const { queued, job } = await requestPublish();
        return queued ? Response.json({ message: 'Publish queued.', job }, { status: 201 }) : Response.json({ message: 'A publish is already queued.', job });
      },
    });

    const { maintenance } = Config.parse(ctx.config ?? {});
    if (maintenance !== undefined) {
      const [object = '', property = ''] = maintenance.split('.');
      const isOn = async () => (await ctx.data.object(object).get(object))?.[property as never] === true;
      ctx.routes.register({
        method: 'GET',
        path: '/maintenance',
        handler: async () =>
          Response.json((await isOn()) ? { text: 'Site offline (maintenance)', tone: 'warning' } : { text: 'Site online', tone: 'success' }),
      });
      // The switch only shows on the site after a build, so flipping it also publishes.
      ctx.routes.register({
        method: 'POST',
        path: '/maintenance',
        handler: async (request) => {
          const on = !(await isOn());
          await ctx.data.object(object).update!(object, { [property]: on }, actorOf(request));
          await publishNow(await published(ctx.data), object, object, await ctx.data.position(), actorOf(request));
          const { queued } = await requestPublish();
          const what = on ? 'The site goes offline' : 'The site comes back online';
          return Response.json({ message: `${what} with ${queued ? 'this publish' : 'the publish already queued'}.` });
        },
      });
      ctx.gui.badge({ id: 'maintenance', route: '/maintenance', placement: 'maintenance' });
      ctx.gui.action({
        id: 'maintenance',
        label: 'Switch maintenance mode',
        route: '/maintenance',
        confirm: 'Switch maintenance mode and publish the site now?',
        placement: 'maintenance',
      });
    }

    ctx.routes.register({ method: 'GET', path: '/status', handler: async () => Response.json(await status(ctx.data)) });

    // The build agent takes the oldest request. It builds what is published when it reads (ADR 7), so a job keeps no position.
    ctx.routes.register({
      method: 'POST',
      path: '/jobs/claim',
      handler: async () => {
        const next = (await jobs(ctx.data)).find((j) => j.status === 'requested');
        if (next === undefined) return new Response(null, { status: 204 });
        const job = await api().update!(next.id, { status: 'building', startedAt: now() });
        return Response.json({ job });
      },
    });

    ctx.routes.register({
      method: 'POST',
      path: '/jobs/:id/done',
      handler: async (request, params) => {
        const parsed = Done.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ code: 'bad_request', message: 'expected { ok: boolean, message?: string }' }, { status: 400 });
        const job = await api().update!(params['id'] as string, {
          status: parsed.data.ok ? 'published' : 'failed',
          finishedAt: now(),
          message: parsed.data.message ?? null,
        });
        return Response.json({ job });
      },
    });

    const content = app.objects.filter((o) => publishable(o.name)).map((o) => o.name);
    ctx.gui.badge({ id: 'status', route: '/status', refresh: 10 });
    ctx.gui.action({
      id: 'publish',
      label: 'Publish all',
      route: '/all',
      hotkey: 'p',
      confirm: "Publish every pending and scheduled change now, including other editors' unfinished work, and update the site?",
    });
    ctx.gui.column({
      id: 'state',
      label: 'State',
      objects: content,
      values: async (object, ids) => {
        const p = await published(ctx.data);
        return Object.fromEntries(ids.map((id) => [id, stateValue(p, object, id)]));
      },
    });
    ctx.gui.badge({ id: 'record', route: '/records/status', placement: 'record', objects: content });
    ctx.gui.action({
      id: 'record',
      label: 'Publish',
      route: '/records/publish',
      placement: 'record',
      objects: content,
      inList: true,
      disabledWhen: { column: 'publish.state', equals: 'Published' },
      input: { type: 'datetime', label: 'Publish on (leave empty to publish now)', optional: true },
    });
  },
};
