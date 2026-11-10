import type { SiteConfig } from './config.js';
import type { SiteContent } from './content.js';
import { fileOf } from './images.js';

// A body link to an asset record, `[label](/assets/<id>)`, becomes the URL of that record's file as the site serves it.
export type FileLinks = (assetId: string) => string | null;

export function safeFileName(name: string): string {
  const safe = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '');
  return safe === '' ? 'file' : safe;
}

export function fileLinkPath(site: SiteConfig, assetId: string, filename: string): string {
  return `${site.server.assets}/${assetId}/${safeFileName(filename)}`;
}

export function createFileLinks(content: SiteContent, site: SiteConfig, onLink?: (assetId: string) => void): FileLinks {
  return (assetId) => {
    const asset = content.assetsById.get(assetId);
    const file = asset === undefined ? null : fileOf(asset);
    if (file === null || typeof file['hash'] !== 'string') return null;
    onLink?.(assetId);
    return fileLinkPath(site, assetId, typeof file['filename'] === 'string' ? file['filename'] : 'file');
  };
}
