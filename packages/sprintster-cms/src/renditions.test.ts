import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import {
  createRenditionSeam,
  encodeRendition,
  parseRenditionName,
  planRenditions,
  renditionName,
  sourceFormat,
  type EncodeRequest,
  type RenditionKey,
} from './renditions.js';

const hash = '66e885789e56a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890';
const images = parseSiteConfig({}).images;

async function photo(width: number, height: number, orientation?: number): Promise<Uint8Array> {
  let pipeline = sharp({ create: { width, height, channels: 3, background: '#4a7' } }).jpeg();
  if (orientation !== undefined) pipeline = pipeline.withMetadata({ orientation });
  return new Uint8Array(await pipeline.toBuffer());
}

describe('renditionName', () => {
  const cases: ReadonlyArray<[RenditionKey, string]> = [
    [{ hash, width: 1200, format: 'avif' }, '66e885789e56a1b2-w1200.avif'],
    [{ hash, width: 480, format: 'jpg' }, '66e885789e56a1b2-w480.jpg'],
    [{ hash, width: 1200, height: 630, fit: 'cover', format: 'webp' }, '66e885789e56a1b2-w1200-h630-cover.webp'],
    [{ hash, width: 300, height: 300, fit: 'inside', format: 'png' }, '66e885789e56a1b2-w300-h300-inside.png'],
    [
      { hash, width: 450, crop: { left: 120, top: 80, width: 900, height: 600 }, format: 'avif' },
      '66e885789e56a1b2-w450-c120x80x900x600.avif',
    ],
    [
      { hash, width: 400, height: 400, fit: 'cover', crop: { left: 0, top: 0, width: 900, height: 600 }, format: 'webp' },
      '66e885789e56a1b2-w400-h400-cover-c0x0x900x600.webp',
    ],
    [
      { hash, width: 1200, height: 630, fit: 'cover', gravity: { x: 0.5, y: 0.2 }, format: 'avif' },
      '66e885789e56a1b2-w1200-h630-cover-g0.5x0.2.avif',
    ],
    [
      { hash, width: 800, height: 800, fit: 'contain', background: '1a2b3c', format: 'jpg' },
      '66e885789e56a1b2-w800-h800-contain-bg1a2b3c.jpg',
    ],
    [
      {
        hash,
        width: 300,
        height: 200,
        fit: 'cover',
        crop: { left: 10, top: 20, width: 600, height: 400 },
        gravity: { x: 1, y: 0 },
        background: 'ffffff',
        format: 'webp',
      },
      '66e885789e56a1b2-w300-h200-cover-c10x20x600x400-g1x0-bgffffff.webp',
    ],
  ];

  it.each(cases)('names %o as %s', (key, name) => {
    expect(renditionName(key)).toBe(name);
  });

  it.each(cases)('parses %s back to its key', (key, name) => {
    expect(parseRenditionName(name)).toEqual({ ...key, hash: hash.slice(0, 16) });
  });

  it('writes the default fit explicitly when a height is present, and drops a fit without one', () => {
    expect(renditionName({ hash, width: 800, height: 400, format: 'avif' })).toBe('66e885789e56a1b2-w800-h400-cover.avif');
    expect(renditionName({ hash, width: 800, fit: 'inside', format: 'avif' })).toBe('66e885789e56a1b2-w800.avif');
  });

  it('drops a gravity that cannot change the pixels: no height, or a fit other than cover', () => {
    const gravity = { x: 0.5, y: 0.2 };
    expect(renditionName({ hash, width: 800, gravity, format: 'avif' })).toBe('66e885789e56a1b2-w800.avif');
    expect(renditionName({ hash, width: 800, height: 400, fit: 'contain', gravity, format: 'avif' })).toBe(
      '66e885789e56a1b2-w800-h400-contain.avif',
    );
  });

  it('rejects anything outside the grammar', () => {
    for (const name of [
      '66e885789e56a1b2.avif',
      '66e885789e56a1b2-w0.avif',
      '66e885789e56a1b2-w800-h400.avif',
      '66e885789e56a1b2-w800-c1x2x3.avif',
      '66e885789e56a1b2-w800-c1x2x0x4.avif',
      '66e885789e56a1b2-c1x2x3x4-w800.avif',
      '66e885789e56a1b2-w800-h400-outside.avif',
      '66e885789e56a1b2-w800-g0.5x0.2-h400-cover.avif',
      '66e885789e56a1b2-w800-h400-cover-g1.5x0.avif',
      '66e885789e56a1b2-w800-bgfff.avif',
      '66e885789e56a1b2-w800-bg#ffffff.avif',
      'x-w800.gif',
      '66e885789e56a1b2-w800.avif/',
    ]) {
      expect(parseRenditionName(name)).toBeNull();
    }
  });
});

describe('sourceFormat', () => {
  it('maps the fallback formats and nothing else', () => {
    expect(sourceFormat('image/jpeg')).toBe('jpg');
    expect(sourceFormat('image/png')).toBe('png');
    expect(sourceFormat('image/gif')).toBeNull();
  });
});

describe('encodeRendition', () => {
  it('is deterministic: the same input yields the same name and bytes twice', async () => {
    const source = await photo(900, 600);
    const a = await encodeRendition(source, { hash, width: 480, format: 'webp' }, images);
    const b = await encodeRendition(source, { hash, width: 480, format: 'webp' }, images);
    expect(a.name).toBe('66e885789e56a1b2-w480.webp');
    expect(b.name).toBe(a.name);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
    expect([a.width, a.height]).toEqual([480, 320]);
  });

  it('never upscales, and names the file by the width it actually has', async () => {
    const source = await photo(900, 600);
    const r = await encodeRendition(source, { hash, width: 1920, format: 'avif' }, images);
    expect(r.width).toBe(900);
    expect(r.name).toBe('66e885789e56a1b2-w900.avif');
  });

  it('crops to a requested height with the fit in the name', async () => {
    const source = await photo(1600, 1200);
    const r = await encodeRendition(source, { hash, width: 1200, format: 'jpg', transform: { height: 630 } }, images);
    expect([r.width, r.height]).toEqual([1200, 630]);
    expect(r.name).toBe('66e885789e56a1b2-w1200-h630-cover.jpg');
  });

  it('cuts a crop rectangle out of the oriented source before resizing', async () => {
    const source = await photo(1600, 1200);
    const crop = { left: 100, top: 200, width: 800, height: 400 };
    const r = await encodeRendition(source, { hash, width: 400, format: 'webp', transform: { crop } }, images);
    expect([r.width, r.height]).toEqual([400, 200]);
    expect(r.name).toBe('66e885789e56a1b2-w400-c100x200x800x400.webp');
    const full = await encodeRendition(source, { hash, width: 1920, format: 'png', transform: { crop } }, images);
    expect([full.width, full.height]).toEqual([800, 400]);
  });

  it('measures a crop against the oriented picture and refuses one that falls outside it', async () => {
    const rotated = await photo(900, 600, 6);
    const inside = { left: 0, top: 0, width: 600, height: 900 };
    expect((await encodeRendition(rotated, { hash, width: 600, format: 'jpg', transform: { crop: inside } }, images)).height).toBe(900);
    const outside = { left: 0, top: 0, width: 900, height: 600 };
    await expect(encodeRendition(rotated, { hash, width: 600, format: 'jpg', transform: { crop: outside } }, images)).rejects.toThrow(
      /outside the 600x900 source/,
    );
  });

  it('centres a cover crop on the gravity point', async () => {
    // Left half red, right half blue: a 1:1 cover of this 2:1 source shows one colour or the other depending on gravity.
    const half = { width: 200, height: 200, channels: 3 as const };
    const source = new Uint8Array(
      await sharp({ create: { width: 400, height: 200, channels: 3, background: '#f00' } })
        .composite([{ input: await sharp({ create: { ...half, background: '#00f' } }).png().toBuffer(), left: 200, top: 0 }])
        .png()
        .toBuffer(),
    );
    const at = async (gravity: { x: number; y: number }) => {
      const r = await encodeRendition(source, { hash, width: 100, format: 'png', transform: { height: 100, gravity } }, images);
      const { data } = await sharp(r.bytes).raw().toBuffer({ resolveWithObject: true });
      return { name: r.name, size: [r.width, r.height], red: data[0], blue: data[2] };
    };
    const left = await at({ x: 0, y: 0.5 });
    const right = await at({ x: 1, y: 0.5 });
    expect(left.size).toEqual([100, 100]);
    expect(left.name).toBe('66e885789e56a1b2-w100-h100-cover-g0x0.5.png');
    expect(right.name).toBe('66e885789e56a1b2-w100-h100-cover-g1x0.5.png');
    expect(left.red).toBeGreaterThan(200);
    expect(right.blue).toBeGreaterThan(200);
  });

  it('pads a contain fit with the background, and flattens alpha onto it for the jpg fallback', async () => {
    const source = new Uint8Array(
      await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0 } } })
        .png()
        .toBuffer(),
    );
    const padded = await encodeRendition(
      source,
      { hash, width: 100, format: 'png', transform: { height: 100, fit: 'contain', background: 'ff0000' } },
      images,
    );
    expect(padded.name).toBe('66e885789e56a1b2-w100-h100-contain-bgff0000.png');
    expect([padded.width, padded.height]).toEqual([100, 100]);
    const { data } = await sharp(padded.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);

    const flat = await encodeRendition(source, { hash, width: 100, format: 'jpg', transform: { background: '00ff00' } }, images);
    const pixel = await sharp(flat.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(pixel.data[1]).toBeGreaterThan(200);
    expect(flat.name).toBe('66e885789e56a1b2-w100-bg00ff00.jpg');
  });

  it('applies EXIF orientation before measuring, so a rotated source comes out upright', async () => {
    const source = await photo(900, 600, 6);
    const r = await encodeRendition(source, { hash, width: 1920, format: 'webp' }, images);
    expect([r.width, r.height]).toEqual([600, 900]);
    expect(r.name).toBe('66e885789e56a1b2-w600.webp');
  });

  it('takes quality from the images config', async () => {
    const source = await new Promise<Uint8Array>((resolve) => {
      void sharp({ create: { width: 600, height: 400, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
        .jpeg()
        .toBuffer()
        .then((b) => resolve(new Uint8Array(b)));
    });
    const low = await encodeRendition(source, { hash, width: 600, format: 'webp' }, parseSiteConfig({ images: { quality: 20 } }).images);
    const high = await encodeRendition(source, { hash, width: 600, format: 'webp' }, parseSiteConfig({ images: { quality: 90 } }).images);
    expect(high.bytes.byteLength).toBeGreaterThan(low.bytes.byteLength);
  });
});

describe('planRenditions', () => {
  const widths = [480, 768, 1200, 1920];
  const jpg = (width: number, height: number) => ({ width, height, format: 'jpg' as const });

  it('caps the ladder at the source width, with the source width as the top rung', () => {
    const plan = planRenditions(jpg(900, 600), {}, widths);
    expect(plan.rungs).toEqual([
      { width: 480, height: 320 },
      { width: 768, height: 512 },
      { width: 900, height: 600 },
    ]);
  });

  it('caps a large source at the top of the configured ladder', () => {
    expect(planRenditions(jpg(4000, 3000), {}, widths).rungs.map((r) => r.width)).toEqual(widths);
  });

  it('takes an authored width as the top of the ladder', () => {
    expect(planRenditions(jpg(4000, 3000), { width: 600 }, widths).rungs.map((r) => r.width)).toEqual([480, 600]);
  });

  it('scales the box with the ladder and keeps it inside the source', () => {
    const plan = planRenditions(jpg(1600, 600), { width: 1200, height: 630 }, widths);
    expect(plan.hasHeight).toBe(true);
    expect(plan.rungs.at(-1)).toEqual({ width: 1142, height: 600 });
    expect(plan.rungs[0]).toEqual({ width: 480, height: 252 });
  });

  it('measures against the crop rectangle rather than the whole source', () => {
    const plan = planRenditions(jpg(4000, 3000), { crop: { left: 0, top: 0, width: 700, height: 350 } }, widths);
    expect(plan.rungs.map((r) => [r.width, r.height])).toEqual([
      [480, 240],
      [700, 350],
    ]);
  });

  it('turns an inside fit into a plain width, so it shares files with one', () => {
    const plan = planRenditions(jpg(1600, 1200), { width: 800, height: 300, fit: 'inside' }, widths);
    expect(plan.hasHeight).toBe(false);
    expect(plan.transform).toEqual({ width: 400 });
  });

  it.each([
    [{}, [900, 600]],
    [{ width: 800, height: 400 }, [1600, 1200]],
    [{ height: 300, fit: 'contain' as const, background: 'ff0000' }, [1600, 1200]],
    [{ width: 500, height: 500, gravity: { x: 0.2, y: 0.5 } }, [1600, 900]],
    [{ crop: { left: 10, top: 20, width: 777, height: 333 }, width: 600, height: 200 }, [1600, 900]],
  ] as const)('names %o before encoding exactly as the encoder does', async (transform, [w, h]) => {
    const source = await photo(w, h);
    const plan = planRenditions(jpg(w, h), transform, widths);
    for (const rung of plan.rungs) {
      const t = plan.hasHeight ? { ...plan.transform, height: rung.height } : plan.transform;
      const r = await encodeRendition(source, { hash, width: rung.width, format: 'jpg', transform: t }, images);
      expect(r.name).toBe(renditionName({ ...t, hash, width: rung.width, format: 'jpg' }));
      expect([r.width, r.height]).toEqual([rung.width, plan.hasHeight ? rung.height : r.height]);
    }
  });
});

describe('createRenditionSeam', () => {
  const site = parseSiteConfig({});
  const asset = { id: 'a1', title: 'Harbour', file: { hash, contentType: 'image/jpeg', width: 600, height: 900 } };
  const content = { assetsById: new Map([['a1', asset]]) } as unknown as SiteContent;

  it('emits a fallback srcset and one source per configured format, and reports every name it emits', () => {
    const demanded = new Map<string, EncodeRequest>();
    const seam = createRenditionSeam(content, site, () => ({ width: 900, height: 600, format: 'jpg' }), (n, r) => demanded.set(n, r));
    const image = seam({ assetId: 'a1', alt: '', transform: {} });
    expect(image).toMatchObject({
      src: '/assets/66e885789e56a1b2-w900.jpg',
      srcset: '/assets/66e885789e56a1b2-w480.jpg 480w, /assets/66e885789e56a1b2-w768.jpg 768w, /assets/66e885789e56a1b2-w900.jpg 900w',
      sizes: '100vw',
      alt: 'Harbour',
      width: 900,
      height: 600,
    });
    expect(image?.sources?.map((s) => s.type)).toEqual(['image/avif', 'image/webp']);
    expect(image?.srcset).not.toMatch(/w1200|w1920/);
    expect(demanded.size).toBe(9);
    expect(demanded.get('66e885789e56a1b2-w768.webp')).toEqual({ hash, width: 768, format: 'webp', transform: {} });
  });

  it('takes the dimensions from the probe, not from the record', () => {
    const seam = createRenditionSeam(content, site, () => ({ width: 900, height: 600, format: 'jpg' }), () => {});
    expect(seam({ assetId: 'a1', alt: '', transform: {} })).toMatchObject({ width: 900, height: 600 });
  });

  it('bounds sizes by an authored width', () => {
    const seam = createRenditionSeam(content, site, () => ({ width: 900, height: 600, format: 'jpg' }), () => {});
    expect(seam({ assetId: 'a1', alt: '', transform: { width: 600 } })?.sizes).toBe('(max-width: 600px) 100vw, 600px');
  });

  it('falls back to the source when the blob cannot be re-encoded', () => {
    const seam = createRenditionSeam(content, site, () => ({ width: 0, height: 0, format: null }), () => {});
    expect(seam({ assetId: 'a1', alt: '', transform: {} })).toEqual({ src: '/api/assets/a1', alt: 'Harbour', width: 600, height: 900 });
  });
});
