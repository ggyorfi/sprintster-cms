import { describe, expect, it } from 'vitest';
import { parseAssetUrl, parseTransform, type ImageSeam } from './images.js';
import { createMarkdown } from './markdown.js';

const seam: ImageSeam = ({ assetId, alt }) =>
  assetId === 'known'
    ? { src: `/assets/${assetId}-800.avif`, alt: alt !== '' ? alt : 'from the record', width: 800, height: 450 }
    : null;

const md = createMarkdown({ images: seam, assetsPrefix: '/assets' });

describe('parseTransform', () => {
  it('reads the comma separated form', () => {
    expect(parseTransform('?width=600,fit=cover')).toEqual({ width: 600, fit: 'cover' });
  });

  it('ignores unknown keys and bad values', () => {
    expect(parseTransform('width=0,height=abc,fit=squish,sharpen=3')).toEqual({});
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

describe('lists', () => {
  it('keeps a tight list tight', () => {
    expect(md.render('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
  });
});
