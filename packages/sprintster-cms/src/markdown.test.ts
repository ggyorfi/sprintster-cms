import { describe, expect, it } from 'vitest';
import { parseAssetUrl, parseTransform, TransformError, type ImageSeam } from './images.js';
import { createMarkdown, pictureHtml } from './markdown.js';

const seam: ImageSeam = ({ assetId, alt }) =>
  assetId === 'known'
    ? { src: `/assets/${assetId}-800.avif`, alt: alt !== '' ? alt : 'from the record', width: 800, height: 450 }
    : null;

const md = createMarkdown({ images: seam, assetsPrefix: '/assets' });

describe('parseTransform', () => {
  it('reads the authored keys', () => {
    expect(parseTransform('?width=600,fit=cover')).toEqual({ width: 600, fit: 'cover' });
    expect(parseTransform('width=600&height=400')).toEqual({ width: 600, height: 400 });
    expect(parseTransform('')).toEqual({});
    expect(parseTransform('width=600,')).toEqual({ width: 600 });
  });

  it('reads a crop rectangle as left, top, width, height in source pixels', () => {
    expect(parseTransform('crop=120x80x900x600,width=450')).toEqual({
      crop: { left: 120, top: 80, width: 900, height: 600 },
      width: 450,
    });
  });

  it('reads gravity as fractions or a side, and background as a hex colour', () => {
    expect(parseTransform('gravity=0.5x0.2')).toEqual({ gravity: { x: 0.5, y: 0.2 } });
    expect(parseTransform('gravity=top')).toEqual({ gravity: { x: 0.5, y: 0 } });
    expect(parseTransform('background=fff')).toEqual({ background: 'ffffff' });
    expect(parseTransform('background=1A2B3C')).toEqual({ background: '1a2b3c' });
  });

  it('rejects an unknown key or a bad value, since a transform is authored content', () => {
    const bad = [
      'widht=600',
      'width=0',
      'height=abc',
      'fit=squish',
      'fit=outside',
      'sharpen=3',
      'crop=1x2x3',
      'crop=1x2x0x4',
      'crop=1,2,3,4',
      'gravity=2x0',
      'gravity=face',
      'background=#ffffff',
      'background=red',
      'width',
    ];
    for (const item of bad) expect(() => parseTransform(item), item).toThrow(TransformError);
  });
});

describe('parseAssetUrl', () => {
  it('reads an id with its transform', () => {
    expect(parseAssetUrl('/assets/abc?width=600', '/assets')).toEqual({ assetId: 'abc', transform: { width: 600 } });
  });

  it('leaves a foreign url alone', () => {
    expect(parseAssetUrl('https://example.com/cat.png', '/assets')).toBeNull();
  });

  it('refuses a direct blob hash', () => {
    const hash = 'a'.repeat(64);
    expect(parseAssetUrl(`/assets/${hash}`, '/assets')).toEqual({ error: expect.stringContaining(hash) });
    expect(parseAssetUrl('/assets/abc?widht=600', '/assets')).toEqual({ error: expect.stringContaining("unknown transform key 'widht'") });
  });
});

describe('image rendering', () => {
  it('resolves an asset reference through the seam', () => {
    const html = md.render('![Harbour](/assets/known)');
    expect(html).toContain('src="/assets/known-800.avif"');
    expect(html).toContain('alt="Harbour"');
    expect(html).toContain('width="800"');
  });

  it('falls back to the record alt when the instance gives none', () => {
    expect(md.render('![](/assets/known)')).toContain('alt="from the record"');
  });

  it('does not wrap a lone image in a paragraph', () => {
    expect(md.render('![Harbour](/assets/known)').trim().startsWith('<img')).toBe(true);
  });

  it('keeps the paragraph when an image sits in a sentence', () => {
    const html = md.render('before ![Harbour](/assets/known) after');
    expect(html.trim().startsWith('<p>')).toBe(true);
  });

  it('fails on an asset that does not exist', () => {
    expect(() => md.render('![x](/assets/missing)')).toThrow(/does not exist/);
  });

  it('fails on a direct blob hash', () => {
    expect(() => md.render(`![x](/assets/${'b'.repeat(64)})`)).toThrow(/blob hash/);
  });

  it('passes an external image through untouched', () => {
    expect(md.render('![x](https://example.com/cat.png)')).toContain('src="https://example.com/cat.png"');
  });
});

describe('pictureHtml', () => {
  it('lists the modern formats ahead of the fallback img, all with the same sizes', () => {
    const html = pictureHtml({
      src: '/assets/h-w768.jpg',
      srcset: '/assets/h-w480.jpg 480w, /assets/h-w768.jpg 768w',
      sizes: '100vw',
      sources: [{ type: 'image/avif', srcset: '/assets/h-w480.avif 480w, /assets/h-w768.avif 768w' }],
      alt: 'Harbour',
      width: 768,
      height: 512,
    });
    expect(html).toBe(
      '<picture><source type="image/avif" srcset="/assets/h-w480.avif 480w, /assets/h-w768.avif 768w" sizes="100vw">' +
        '<img src="/assets/h-w768.jpg" srcset="/assets/h-w480.jpg 480w, /assets/h-w768.jpg 768w" sizes="100vw" alt="Harbour" width="768" height="512" loading="lazy" decoding="async"></picture>',
    );
  });

  it('is a bare img when the seam has no renditions', () => {
    expect(pictureHtml({ src: '/api/assets/x', alt: 'a' })).toBe('<img src="/api/assets/x" alt="a" loading="lazy" decoding="async">');
  });
});

describe('lists', () => {
  it('keeps a tight list tight', () => {
    expect(md.render('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
  });
});
