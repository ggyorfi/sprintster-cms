import MarkdownIt from 'markdown-it';
import { escape } from './filters.js';
import { parseAssetUrl, type ImageSeam } from './images.js';

export interface MarkdownOptions {
  images: ImageSeam;
  assetsPrefix: string;
}

function attrs(pairs: ReadonlyArray<[string, string | number | undefined]>): string {
  return pairs
    .filter((pair): pair is [string, string | number] => pair[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escape(value)}"`)
    .join('');
}

// A figure may not sit inside a paragraph, so a paragraph holding nothing but an image loses its wrapper.
function isLoneImage(tokens: ReturnType<MarkdownIt['parse']>, idx: number): boolean {
  const inline = tokens[idx + 1];
  if (inline === undefined || inline.type !== 'inline') return false;
  const children = (inline.children ?? []).filter((t) => !(t.type === 'text' && t.content.trim() === ''));
  return children.length === 1 && children[0]?.type === 'image';
}

export function createMarkdown(opts: MarkdownOptions): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

  md.renderer.rules['paragraph_open'] = (tokens, idx) =>
    tokens[idx]?.hidden === true || isLoneImage(tokens, idx) ? '' : '<p>';
  md.renderer.rules['paragraph_close'] = (tokens, idx) =>
    tokens[idx]?.hidden === true || isLoneImage(tokens, idx - 2) ? '' : '</p>';

  md.renderer.rules['image'] = (tokens, idx) => {
    const token = tokens[idx];
    if (token === undefined) return '';
    const src = token.attrGet('src') ?? '';
    const alt = token.content ?? '';
    const parsed = parseAssetUrl(src, opts.assetsPrefix);

    if (parsed === null) return `<img${attrs([['src', src], ['alt', alt], ['loading', 'lazy']])}>`;
    if ('error' in parsed) throw new Error(parsed.error);

    const image = opts.images({ assetId: parsed.assetId, alt, transform: parsed.transform });
    if (image === null) throw new Error(`body references an asset that does not exist: ${src}`);

    const tag = `<img${attrs([
      ['src', image.src],
      ['alt', image.alt],
      ['width', image.width],
      ['height', image.height],
      ['loading', 'lazy'],
      ['decoding', 'async'],
    ])}>`;

    if (image.caption === undefined && image.credit === undefined) return tag;
    const caption = image.caption === undefined ? '' : escape(image.caption);
    const credit = image.credit === undefined ? '' : `<span class="credit">${escape(image.credit)}</span>`;
    return `<figure>${tag}<figcaption>${caption}${credit}</figcaption></figure>`;
  };

  return md;
}
