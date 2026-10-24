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
  fit?: Fit;
  crop?: Crop;
  gravity?: Gravity;
  background?: string;
}

// The authored grammar is docs/ADR/0001-rendition-file-names.md. `outside` is deliberately absent: no media service can express it.
export type Fit = 'cover' | 'contain' | 'fill' | 'inside';

// A region of the oriented source, in pixels, taken before any resize.
export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where a cover crop centres, as fractions of the (cropped) source.
export interface Gravity {
  x: number;
  y: number;
}

export interface ImageSource {
  type: string;
  srcset: string;
}

// `src` and `srcset` are the source-format fallback; `sources` are the modern formats a `<picture>` lists ahead of it.
export interface RenderedImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
  srcset?: string;
  sizes?: string;
  sources?: ImageSource[];
}

// Every image decision goes through this one call, so a change of output strategy (baked renditions, a CDN) never reaches a template or a markdown rule.
export type ImageSeam = (request: ImageRequest) => RenderedImage | null;

export class TransformError extends Error {}

const FITS = new Set<string>(['cover', 'contain', 'fill', 'inside']);
const GRAVITY_NAMES: Record<string, Gravity> = {
  center: { x: 0.5, y: 0.5 },
  centre: { x: 0.5, y: 0.5 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
};
const FRACTION = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;
const HEX_COLOUR = /^[0-9a-fA-F]{3,4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/;

export function parseCrop(value: string): Crop | null {
  const parts = value.split('x').map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n) && n >= 0)) return null;
  const [left, top, width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

export function cropToString(crop: Crop): string {
  return `${crop.left}x${crop.top}x${crop.width}x${crop.height}`;
}

export function parseGravity(value: string): Gravity | null {
  const named = GRAVITY_NAMES[value];
  if (named !== undefined) return named;
  const [x, y, ...rest] = value.split('x');
  if (x === undefined || y === undefined || rest.length > 0 || !FRACTION.test(x) || !FRACTION.test(y)) return null;
  return { x: Number(x), y: Number(y) };
}

export function gravityToString(gravity: Gravity): string {
  return `${gravity.x}x${gravity.y}`;
}

// Hex only, no '#': it is a file name segment as well as a query value. Short forms expand so one colour has one spelling.
export function parseBackground(value: string): string | null {
  if (!HEX_COLOUR.test(value)) return null;
  const hex = value.toLowerCase();
  return hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
}

function positiveInt(key: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new TransformError(`${key} must be a positive integer, got '${value}'`);
  return n;
}

// Authored content, so a wrong key is a content error rather than a silent full-size image.
export function parseTransform(search: string): Transform {
  const transform: Transform = {};
  const source = search.startsWith('?') ? search.slice(1) : search;
  for (const item of source.split(/[,&]/)) {
    if (item.trim() === '') continue;
    const at = item.indexOf('=');
    if (at === -1) throw new TransformError(`expected key=value, got '${item}'`);
    const key = item.slice(0, at).trim();
    const value = item.slice(at + 1).trim();
    switch (key) {
      case 'width':
      case 'height':
        transform[key] = positiveInt(key, value);
        break;
      case 'fit':
        if (!FITS.has(value)) throw new TransformError(`fit must be one of ${[...FITS].join(', ')}, got '${value}'`);
        transform.fit = value as Fit;
        break;
      case 'crop': {
        const crop = parseCrop(value);
        if (crop === null) throw new TransformError(`crop must be left x top x width x height in pixels, got '${value}'`);
        transform.crop = crop;
        break;
      }
      case 'gravity': {
        const gravity = parseGravity(value);
        if (gravity === null) throw new TransformError(`gravity must be x x y as fractions 0 to 1, or a side, got '${value}'`);
        transform.gravity = gravity;
        break;
      }
      case 'background': {
        const background = parseBackground(value);
        if (background === null) throw new TransformError(`background must be a hex colour without '#', got '${value}'`);
        transform.background = background;
        break;
      }
      default:
        throw new TransformError(`unknown transform key '${key}'`);
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
  try {
    return { assetId: id, transform: parseTransform(search) };
  } catch (err) {
    if (err instanceof TransformError) return { error: `invalid transform in ${src}: ${err.message}` };
    throw err;
  }
}

export function fileOf(asset: Row): Record<string, unknown> | null {
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
export function sourceImage(asset: Row, alt: string, site: SiteConfig): RenderedImage {
  const file = fileOf(asset);
  const result: RenderedImage = {
    src: `${site.server.api}${site.server.assets}/${asset.id}`,
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
}

export function createSourceSeam(content: SiteContent, site: SiteConfig): ImageSeam {
  return ({ assetId, alt }) => {
    const asset = content.assetsById.get(assetId);
    return asset === undefined ? null : sourceImage(asset, alt, site);
  };
}
