import type { ObjectConfig } from 'sprintster';
import type { SiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import type { Theme } from './theme.js';

export const MAINTENANCE_TEMPLATE = 'maintenance';

interface Switch {
  object: string;
  property: string;
}

// Checked on every build, so a broken setup surfaces early; a switch the app lacks only warns, so an admin deployed late cannot stop publishing.
export function maintenanceSwitch(site: SiteConfig, objects: readonly ObjectConfig[], theme: Theme, warn: (message: string) => void = console.warn): Switch | null {
  if (site.maintenance === undefined) return null;
  const [object = '', property = ''] = site.maintenance.split('.');
  const where = `scms.config.json maintenance '${site.maintenance}'`;
  if (!theme.has(MAINTENANCE_TEMPLATE)) throw new Error(`${where}: theme '${theme.dirs[0]}' has no ${MAINTENANCE_TEMPLATE}.eta`);
  const obj = objects.find((o) => o.name === object);
  if (obj !== undefined && obj.singleton !== true) throw new Error(`${where}: '${object}' must be a singleton, so the site has one switch`);
  const prop = obj?.properties.find((p) => p.name === property);
  if (prop !== undefined && prop.type !== 'boolean') throw new Error(`${where}: '${object}.${property}' must be a boolean`);
  if (prop === undefined) {
    warn(`${where}: the app has no '${object}.${property}' yet, so maintenance mode is off; deploy the admin to add it`);
    return null;
  }
  return { object, property };
}

export function inMaintenance(sw: Switch | null, content: SiteContent): boolean {
  return sw !== null && content.rows.get(sw.object)?.[0]?.[sw.property] === true;
}
