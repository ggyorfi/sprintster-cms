import type { DaemonPlugin, PluginData } from 'sprintster';
import { z } from 'zod';

export const JOB_OBJECT = 'publishJob';

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
];

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const byTime = (a: PublishJob, b: PublishJob) => a.requestedAt.localeCompare(b.requestedAt);

async function jobs(data: PluginData): Promise<PublishJob[]> {
  return ((await data.object(JOB_OBJECT).list()) as unknown as Array<PublishJob & { removed?: boolean }>)
    .filter((j) => j.removed !== true)
    .sort(byTime);
}

// Distinct records changed since the last publish; the plugin's own job records are not content.
export async function unpublished(data: PluginData, published: PublishJob | undefined): Promise<number> {
  const changes = await data.changesSince(published?.position ?? 0);
  return new Set(changes.filter((c) => c.object !== JOB_OBJECT).map((c) => `${c.object}:${c.id}`)).size;
}

export async function status(data: PluginData): Promise<{ text: string; tone: 'info' | 'warning' | 'success' | 'danger' }> {
  const all = await jobs(data);
  const active = all.find((j) => j.status === 'requested' || j.status === 'building');
  if (active !== undefined) return { text: active.status === 'building' ? 'Publishing…' : 'Publish queued', tone: 'info' };
  const published = all.filter((j) => j.status === 'published').at(-1);
  const count = await unpublished(data, published);
  const last = all.at(-1);
  if (last?.status === 'failed') return { text: `Publish failed: ${last.message ?? 'see Publishing'}`, tone: 'danger' };
  if (published === undefined) return { text: 'Not published yet', tone: 'warning' };
  if (count === 0) return { text: 'Published', tone: 'success' };
  return { text: `${count} unpublished change${count === 1 ? '' : 's'}`, tone: 'warning' };
}

const Done = z.object({ ok: z.boolean(), message: z.string().optional() });

// `maintenance`: the same `<singleton>.<boolean>` as scms.config.json's; with it, the Maintenance page gets the switch.
const Config = z.object({ maintenance: z.string().regex(/^\w+\.\w+$/, 'must be <singleton>.<boolean property>').optional() }).strict();

export const plugin: DaemonPlugin = {
  name: 'sprintster-cms/publish',
  namespace: 'publish',
  version: '1',
  capabilities: [],
  config: Config,
  init(ctx) {
    const api = () => ctx.data.object(JOB_OBJECT);
    // Agents listen here and claim over HTTP when told; a push carries no job, so a missed one costs nothing.
    const agents = ctx.channels.open('jobs');

    async function requestPublish(): Promise<{ queued: boolean; job: PublishJob }> {
      const active = (await jobs(ctx.data)).find((j) => j.status === 'requested' || j.status === 'building');
      if (active !== undefined) return { queued: false, job: active };
      const job = (await api().add!({ id: crypto.randomUUID(), status: 'requested', requestedAt: now() })) as unknown as PublishJob;
      agents.send({ type: 'job' });
      return { queued: true, job };
    }

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
        handler: async () => {
          const on = !(await isOn());
          await ctx.data.object(object).update!(object, { [property]: on });
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

    // The build agent takes the oldest request. The log position is read now, before it reads any content, so the
    // publish covers at least everything up to it.
    ctx.routes.register({
      method: 'POST',
      path: '/jobs/claim',
      handler: async () => {
        const next = (await jobs(ctx.data)).find((j) => j.status === 'requested');
        if (next === undefined) return new Response(null, { status: 204 });
        const job = await api().update!(next.id, { status: 'building', startedAt: now(), position: await ctx.data.position() });
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

    ctx.gui.badge({ id: 'status', route: '/status', refresh: 10 });
    ctx.gui.action({ id: 'publish', label: 'Publish', route: '/requests', hotkey: 'p', confirm: 'Publish the site now?' });
  },
};
