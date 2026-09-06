import type { SiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import type { Row } from './daemon.js';

export interface ImageRequest {
  assetId: string;
  alt: string;
  transform: Transform;
}

export interface Transform {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

export interface RenderedImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
}

// Every image decision goes through this one call, so a change of output strategy (baked renditions, a CDN) never reaches a template or a markdown rule.
export type ImageSeam = (request: ImageRequest) => RenderedImage | null;

const FITS = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);

export function parseTransform(search: string): Transform {
  const transform: Transform = {};
  const source = search.startsWith('?') ? search.slice(1) : search;
  for (const item of source.split(/[,&]/)) {
    const at = item.indexOf('=');
    if (at === -1) continue;
    const key = item.slice(0, at).trim();
    const value = item.slice(at + 1).trim();
    if (key === 'width' || key === 'height') {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) transform[key] = n;
    } else if (key === 'fit' && FITS.has(value)) {
      transform.fit = value as Transform['fit'];
    }
  }
  return transform;
}

const HEX64 = /^[0-9a-f]{64}$/;

export interface ParsedAssetUrl {
  assetId: string;
  transform: Transform;
}

// A hash URL is refused rather than resolved: only the asset record may reference a blob, so a body pointing straight at bytes is a content error.
export function parseAssetUrl(src: string, assetsPrefix: string): ParsedAssetUrl | { error: string } | null {
  const [path, search = ''] = src.split('?');
  if (path === undefined || !path.startsWith(`${assetsPrefix}/`)) return null;
  const id = path.slice(assetsPrefix.length + 1);
  if (id === '' || id.includes('/')) return null;
  if (HEX64.test(id)) return { error: `body references a blob hash directly: ${src}` };
  return { assetId: id, transform: parseTransform(search) };
}

function fileOf(asset: Row): Record<string, unknown> | null {
  const file = asset['file'];
  return file !== null && typeof file === 'object' ? (file as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

// Source mode: the original bytes from the daemon, which is what the editor previews. Rendition modes replace this body, not its callers.
export function createSourceSeam(content: SiteContent, site: SiteConfig): ImageSeam {
  return ({ assetId, alt }) => {
    const asset = content.assetsById.get(assetId);
    if (asset === undefined) return null;
    const file = fileOf(asset);
    const result: RenderedImage = {
      src: `${site.server.api}${site.server.assets}/${assetId}`,
      alt: alt !== '' ? alt : str(file?.['alt']) ?? str(asset['title']) ?? '',
    };
    const width = num(file?.['width']);
    const height = num(file?.['height']);
    const caption = str(asset['caption']);
    const credit = str(asset['credit']);
    if (width !== undefined) result.width = width;
    if (height !== undefined) result.height = height;
    if (caption !== undefined) result.caption = caption;
    if (credit !== undefined) result.credit = credit;
    return result;
  };
}
