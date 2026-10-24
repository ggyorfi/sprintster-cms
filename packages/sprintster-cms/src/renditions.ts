import sharp from 'sharp';
import type { SiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import {
  cropToString,
  fileOf,
  gravityToString,
  parseCrop,
  type Crop,
  type Fit,
  type Gravity,
  type ImageSeam,
  type ImageSource,
  type Transform,
  sourceImage,
} from './images.js';

// The name grammar is docs/ADR/0001-rendition-file-names.md; renditionName and parseRenditionName are its only readers and writers.
export type RenditionFormat = 'avif' | 'webp' | 'jpg' | 'png';

export interface RenditionKey {
  hash: string;
  width: number;
  format: RenditionFormat;
  height?: number;
  fit?: Fit;
  crop?: Crop;
  gravity?: Gravity;
  background?: string;
}

export interface Rendition extends RenditionKey {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  height: number;
}

const HASH16 = 16;
const DEFAULT_BACKGROUND = 'ffffff';
const NAME =
  /^([0-9a-f]{16})-w([1-9][0-9]*)(?:-h([1-9][0-9]*)-(cover|contain|fill|inside))?(?:-c(\d+x\d+x[1-9]\d*x[1-9]\d*))?(?:-g((?:0(?:\.\d{1,3})?|1)x(?:0(?:\.\d{1,3})?|1)))?(?:-bg([0-9a-f]{6}|[0-9a-f]{8}))?\.(avif|webp|jpg|png)$/;

// A key only reaches the name when it can change the pixels: fit and gravity need a height, gravity needs a cover fit.
function effective(key: RenditionKey): RenditionKey {
  const out: RenditionKey = { hash: key.hash, width: key.width, format: key.format };
  if (key.height !== undefined) {
    out.height = key.height;
    out.fit = key.fit ?? 'cover';
    if (out.fit === 'cover' && key.gravity !== undefined) out.gravity = key.gravity;
  }
  if (key.crop !== undefined) out.crop = key.crop;
  if (key.background !== undefined) out.background = key.background;
  return out;
}

export function renditionName(key: RenditionKey): string {
  const k = effective(key);
  const size = k.height === undefined ? '' : `-h${k.height}-${k.fit}`;
  const crop = k.crop === undefined ? '' : `-c${cropToString(k.crop)}`;
  const gravity = k.gravity === undefined ? '' : `-g${gravityToString(k.gravity)}`;
  const background = k.background === undefined ? '' : `-bg${k.background}`;
  return `${k.hash.slice(0, HASH16)}-w${k.width}${size}${crop}${gravity}${background}.${k.format}`;
}

export function parseRenditionName(name: string): RenditionKey | null {
  const m = NAME.exec(name);
  if (m === null) return null;
  const [, hash, width, height, fit, crop, gravity, background, format] = m as unknown as [
    string,
    string,
    string,
    string?,
    Fit?,
    string?,
    string?,
    string?,
    RenditionFormat?,
  ];
  const key: RenditionKey = { hash, width: Number(width), format: format as RenditionFormat };
  if (height !== undefined) {
    key.height = Number(height);
    key.fit = fit as Fit;
  }
  if (crop !== undefined) key.crop = parseCrop(crop) as Crop;
  if (gravity !== undefined) {
    const [x, y] = gravity.split('x') as [string, string];
    key.gravity = { x: Number(x), y: Number(y) };
  }
  if (background !== undefined) key.background = background;
  return effective(key) as RenditionKey;
}

export function sourceFormat(contentType: string): 'jpg' | 'png' | null {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  return null;
}

export interface EncodeRequest {
  hash: string;
  width: number;
  format: RenditionFormat;
  transform?: Transform;
}

function encoder(pipeline: sharp.Sharp, format: RenditionFormat, quality: number): sharp.Sharp {
  switch (format) {
    case 'avif':
      return pipeline.avif({ quality });
    case 'webp':
      return pipeline.webp({ quality });
    case 'jpg':
      return pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    case 'png':
      return pipeline.png();
  }
}

// sharp positions a cover crop by name or by saliency, not by a point, so a focal point becomes a source-space rectangle of the target aspect.
function focalWindow(sw: number, sh: number, aspect: number, gravity: Gravity): Crop {
  if (sw / sh > aspect) {
    const width = Math.max(1, Math.round(sh * aspect));
    return { left: Math.min(Math.max(Math.round(gravity.x * sw - width / 2), 0), sw - width), top: 0, width, height: sh };
  }
  const height = Math.max(1, Math.round(sw / aspect));
  return { left: 0, top: Math.min(Math.max(Math.round(gravity.y * sh - height / 2), 0), sh - height), width: sw, height };
}

// Orientation is applied first so the crop rectangle, the focal window and the cap all see the picture as it displays.
export async function encodeRendition(
  source: Uint8Array,
  request: EncodeRequest,
  images: SiteConfig['images'],
): Promise<Rendition> {
  const { transform = {} } = request;
  const background = `#${transform.background ?? DEFAULT_BACKGROUND}`;
  let pipeline = sharp(source).rotate();
  let { width: sw = 0, height: sh = 0 } = (await pipeline.metadata()).autoOrient;
  if (transform.crop !== undefined) {
    const c = transform.crop;
    if (c.left + c.width > sw || c.top + c.height > sh) {
      throw new Error(`crop ${cropToString(c)} lies outside the ${sw}x${sh} source`);
    }
    pipeline = pipeline.extract(c);
    sw = c.width;
    sh = c.height;
  }
  const resize: sharp.ResizeOptions = { width: request.width, withoutEnlargement: true };
  if (transform.height !== undefined) {
    resize.height = transform.height;
    resize.fit = transform.fit ?? 'cover';
    if (resize.fit === 'cover' && transform.gravity !== undefined) {
      pipeline = pipeline.extract(focalWindow(sw, sh, request.width / transform.height, transform.gravity));
    }
    if (resize.fit === 'contain') resize.background = background;
  }
  pipeline = pipeline.resize(resize);
  if (request.format === 'jpg') pipeline = pipeline.flatten({ background });
  const { data, info } = await encoder(pipeline, request.format, images.quality).toBuffer({ resolveWithObject: true });
  const key: RenditionKey = { ...transform, hash: request.hash, width: info.width, format: request.format };
  if (transform.height !== undefined) key.height = info.height;
  const named = effective(key);
  return { ...named, height: info.height, name: renditionName(named), bytes: new Uint8Array(data) };
}

// The oriented size of a source blob, measured once per hash. `format` is null for a source sharp should not re-encode.
export interface SourceProbe {
  width: number;
  height: number;
  format: 'jpg' | 'png' | null;
}

export interface Rung {
  width: number;
  height: number;
}

export interface RenditionPlan {
  transform: Transform;
  rungs: Rung[];
  hasHeight: boolean;
}

// Every rung fits inside the (cropped) source, so the encoder never enlarges and each file comes out exactly at its rung, which is what lets a name be computed before anything is encoded.
export function planRenditions(probe: SourceProbe, transform: Transform, widths: readonly number[]): RenditionPlan {
  const sw = transform.crop?.width ?? probe.width;
  const sh = transform.crop?.height ?? probe.height;
  const boxWidth = transform.width ?? Math.min(Math.max(...widths), sw);
  let t: Transform = { ...transform };
  // An inside fit is a plain resize once the source size is known, so it shares files with one.
  if (t.height !== undefined && t.fit === 'inside') {
    const { height, fit: _fit, gravity: _gravity, ...rest } = t;
    t = { ...rest, width: Math.min(boxWidth, Math.max(1, Math.round((height * sw) / sh))) };
  }
  const ladder = (top: number): number[] => [...new Set([...widths.filter((w) => w < top), top])].sort((a, b) => a - b);
  if (t.height === undefined) {
    const top = Math.min(t.width ?? boxWidth, sw);
    return {
      transform: t,
      rungs: ladder(top).map((w) => ({ width: w, height: Math.max(1, Math.round((w * sh) / sw)) })),
      hasHeight: false,
    };
  }
  const aspect = boxWidth / t.height;
  const top = Math.max(1, Math.min(boxWidth, sw, Math.floor(sh * aspect)));
  return {
    transform: t,
    rungs: ladder(top).map((w) => ({ width: w, height: Math.max(1, Math.round(w / aspect)) })),
    hasHeight: true,
  };
}

export type Demand = (name: string, request: EncodeRequest) => void;

const MIME: Record<RenditionFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

export function renditionContentType(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return MIME[ext as RenditionFormat];
}

// Bake mode. The seam names every rendition it emits and reports it through `demand`, which is the only list of files that may be encoded.
export function createRenditionSeam(
  content: SiteContent,
  site: SiteConfig,
  probeOf: (hash: string) => SourceProbe | undefined,
  demand: Demand,
): ImageSeam {
  return ({ assetId, alt, transform }) => {
    const asset = content.assetsById.get(assetId);
    if (asset === undefined) return null;
    const base = sourceImage(asset, alt, site);
    const hash = fileOf(asset)?.['hash'];
    const probe = typeof hash === 'string' ? probeOf(hash) : undefined;
    if (typeof hash !== 'string' || probe === undefined || probe.format === null) return base;

    const plan = planRenditions(probe, transform, site.images.widths);
    const urls = (format: RenditionFormat): string[] =>
      plan.rungs.map((rung) => {
        const t = plan.hasHeight ? { ...plan.transform, height: rung.height } : plan.transform;
        const name = renditionName({ ...t, hash, width: rung.width, format });
        demand(name, { hash, width: rung.width, format, transform: t });
        return `${site.server.assets}/${name}`;
      });
    const srcset = (list: string[]): string => list.map((url, i) => `${url} ${plan.rungs[i]?.width}w`).join(', ');

    const top = plan.rungs[plan.rungs.length - 1] as Rung;
    const fallback = urls(probe.format);
    const sources: ImageSource[] = site.images.formats.map((format) => ({ type: MIME[format], srcset: srcset(urls(format)) }));
    return {
      ...base,
      src: fallback[fallback.length - 1] as string,
      srcset: srcset(fallback),
      sizes: transform.width === undefined ? '100vw' : `(max-width: ${top.width}px) 100vw, ${top.width}px`,
      sources,
      width: top.width,
      height: top.height,
    };
  };
}
