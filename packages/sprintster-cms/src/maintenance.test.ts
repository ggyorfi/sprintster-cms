import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCollections } from './collections.js';
import { parseSiteConfig } from './config.js';
import { loadContent } from './content.js';
import type { Daemon, Row } from './daemon.js';
import { inMaintenance, maintenanceSwitch } from './maintenance.js';
import { createRenderer } from './render.js';
import { urlSpace } from './routes.js';
import { createMedia } from './media.js';
import { createSiteApp } from './serve.js';
import { loadTheme } from './theme.js';
import { object } from './test-objects.js';

const objects = [
  object('page', 'pages', [{ name: 'title', type: 'text' }, { name: 'slug', type: 'text' }]),
  object(
    'settings',
    'settings',
    [
      { name: 'offline', type: 'boolean' },
      { name: 'message', type: 'markdown' },
    ],
    { singleton: true, lifecycle: undefined },
  ),
];

function theme(withTemplate = true) {
  const dir = mkdtempSync(join(tmpdir(), 'scms-maintenance-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'layout.eta'), '<nav>menu</nav><%~ it.content %>');
  writeFileSync(join(dir, 'page.eta'), '<%= it.page.title %>');
  if (withTemplate) writeFileSync(join(dir, 'maintenance.eta'), '<p>away</p><%~ it.data.settings.message %>');
  return loadTheme(dir, dir);
}

function fakeDaemon(settings: Row): Daemon {
  return {
    baseUrl: 'http://daemon',
    objects,
    locales: [],
    object: (name) => objects.find((o) => o.name === name)!,
    rows: async (name) => (name === 'settings' ? [settings] : [{ id: 'p1', title: 'About', slug: 'about' }]),
    asset: async () => ({ bytes: new Uint8Array(), contentType: 'image/png' }),
  };
}

async function setup(settings: Row, maintenance = 'settings.offline') {
  const site = parseSiteConfig({ maintenance });
  const collections = buildCollections(site, objects);
  const content = await loadContent(fakeDaemon(settings), collections);
  return { site, collections, content };
}

describe('maintenance mode', () => {
  it('is on only while the switch is true', async () => {
    const t = theme();
    const on = await setup({ id: 'settings', offline: true, message: 'Back soon' });
    const off = await setup({ id: 'settings', offline: false });
    expect(inMaintenance(maintenanceSwitch(on.site, objects, t), on.content)).toBe(true);
    expect(inMaintenance(maintenanceSwitch(off.site, objects, t), off.content)).toBe(false);
  });

  it('renders the maintenance page without the layout and its links', async () => {
    const { site, collections, content } = await setup({ id: 'settings', offline: true, message: 'Back **soon**' });
    const html = createRenderer(theme(), site, content, urlSpace(site, collections, {})).maintenance();
    expect(html).toContain('<p>away</p>');
    expect(html).toContain('<strong>soon</strong>');
    expect(html).not.toContain('menu');
  });

  it('refuses a switch that is not a boolean on a singleton, or a theme without the page', async () => {
    const { site } = await setup({ id: 'settings' });
    expect(() => maintenanceSwitch(parseSiteConfig({ maintenance: 'settings.message' }), objects, theme())).toThrow(/'settings.message' must be a boolean/);
    expect(() => maintenanceSwitch(parseSiteConfig({ maintenance: 'page.title' }), objects, theme())).toThrow(/must be a singleton/);
    expect(() => maintenanceSwitch(site, objects, theme(false))).toThrow(/no maintenance\.eta/);
    expect(() => parseSiteConfig({ maintenance: 'offline' })).toThrow(/<singleton>\.<boolean property>/);
  });

  it('only warns, and stays off, while the app does not have the switch yet', () => {
    const warnings: string[] = [];
    for (const maintenance of ['settings.paused', 'nope.offline']) {
      expect(maintenanceSwitch(parseSiteConfig({ maintenance }), objects, theme(), (m) => warnings.push(m))).toBeNull();
    }
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/deploy the admin/);
  });

  it('is off when the site does not configure it', async () => {
    const { content } = await setup({ id: 'settings', offline: true });
    expect(inMaintenance(maintenanceSwitch(parseSiteConfig({}), objects, theme(false)), content)).toBe(false);
  });

  it('serves the maintenance page outside /preview, and the real site under it', async () => {
    const site = parseSiteConfig({ maintenance: 'settings.offline' });
    const root = mkdtempSync(join(tmpdir(), 'scms-serve-'));
    const daemon = fakeDaemon({ id: 'settings', offline: true, message: 'Back soon' });
    const app = createSiteApp(site, daemon, theme(), createMedia(daemon, site, root));
    const home = await app.request('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('away');
    const page = await app.request('/pages/about');
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('away');
    const preview = await app.request('/preview/pages/about');
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('<nav>menu</nav>About');
  });
});
