# 1. The transform grammar and rendition file names

Date: 2026-09-06, schema finalised 2026-09-07

## Status

Accepted. Refines the "content addressed output" guard in
[media-model.md](../media-model.md).

## Context

A transform is the authored intent for one use of an image: it is written into
content as a query string on the asset URL, so every key is a permanent
contract. A rendition is one source image encoded under one transform at one
width in one format, and the media model requires its file name to be a pure
function of those, so that identical renditions collapse across instances and
builds and the persistent cache never goes stale.

Static exports bake every rendition. A later `images.mode: 'url'` hands the
same transform to a media service, Cloudflare Images first, and encodes
nothing. Extra mapping work then is acceptable; a key that a service cannot
express at all is not. So the grammar is fixed here against Cloudflare's URL
schema, taking its names for keys that both need, and leaving out what it
cannot do.

## Decision

### The authored grammar

Comma separated `key=value`, in the query of `/assets/<id>`:

| key | value | meaning |
| --- | --- | --- |
| `width` | positive integer | target width in pixels, the top of the ladder for this use |
| `height` | positive integer | target height at that width; the ladder scales both, so together they fix an aspect ratio |
| `fit` | `cover`, `contain`, `fill`, `inside` | how the picture meets the box; default `cover` when a height is given. sharp's names, minus `outside`, which no service can express |
| `crop` | `left x top x width x height`, e.g. `120x80x900x600` | a rectangle of the oriented source, taken before anything else |
| `gravity` | `x x y` as fractions 0 to 1, e.g. `0.5x0.2`, or `left`, `right`, `top`, `bottom`, `center` | where a `cover` crop centres, relative to the source after `crop` |
| `background` | hex without `#`, 3, 4, 6 or 8 digits, e.g. `fff`, `1a2b3c` | the colour behind `contain` padding and under alpha in the jpg fallback; default white |

Quality, format and pixel density are never authored: quality and formats are
build config, density is the ladder.

An unknown key or an invalid value is a content error and fails the render.
The earlier behaviour, dropping it silently, shipped the full-size image on a
typo without a word.

### The file name

```
<hash16>-w<W>[-h<H>-<fit>][-c<L>x<T>x<CW>x<CH>][-g<X>x<Y>][-bg<hex>].<ext>
```

- `hash16`: the first 16 hex characters of the blob's sha256. 64 bits is
  collision-free for any realistic library and keeps a URL around 40
  characters. The full hash stays the identity everywhere else.
- `w<W>`: the width of the encoded file, after the never-upscale cap. Two
  requests that cap to the same width are the same file.
- `h<H>-<fit>`: present only when the transform has a height. `fit` is always
  written when a height is, so the name never depends on a default.
- `c…`: the crop rectangle, the same literal as authored.
- `g<X>x<Y>`: the gravity, normalised to fractions, present only when it can
  change the pixels: a height is present and the fit is `cover`.
- `bg<hex>`: the background, expanded to 6 or 8 lowercase digits, present
  whenever authored.
- `ext`: `avif`, `webp`, `jpg` or `png`. The last two are the source's own
  format, the resized fallback for browsers without the modern formats.

A key that cannot change the pixels is dropped from the name, so
`fit=inside` without a height or `gravity=top` under `contain` names the same
file as without it. Segments come in a fixed order and a name out of order is
invalid.

Examples:

```
66e885789e56a1b2-w1200.avif
66e885789e56a1b2-w1200-h630-cover.webp
66e885789e56a1b2-w450-c120x80x900x600.avif
66e885789e56a1b2-w1200-h630-cover-g0.5x0.2.avif
66e885789e56a1b2-w800-h800-contain-bg1a2b3c.jpg
```

The grammar as one regex:

```
^([0-9a-f]{16})-w([1-9][0-9]*)(?:-h([1-9][0-9]*)-(cover|contain|fill|inside))?(?:-c(\d+x\d+x[1-9]\d*x[1-9]\d*))?(?:-g((?:0(?:\.\d{1,3})?|1)x(?:0(?:\.\d{1,3})?|1)))?(?:-bg([0-9a-f]{6}|[0-9a-f]{8}))?\.(avif|webp|jpg|png)$
```

The name carries no quality, no source dimensions and no asset id. Quality is
build config, and changing it is a deliberate cache flush. Source dimensions
are implied by the hash. The asset id is a record concern: a record can be
re-pointed at another blob without touching any rendition.

### Encoding order

Orientation from EXIF, then `crop`, then the gravity window for a `cover`
fit, then the resize with the cap, then padding for `contain`, then for jpg a
flatten onto the background. A crop rectangle outside the source is an error,
never clamped, because a clamped name would lie about its contents.

### The Cloudflare mapping, expected

For `images.mode: 'url'`. Everything authored has a Cloudflare form; the two
keys we took their names for carry over as they are. Their upscaling rules
per fit must be checked when the module is built, since we never upscale.

| ours | Cloudflare |
| --- | --- |
| `width`, `height` | `width`, `height` |
| `fit=cover` | `fit=crop` (cover without upscaling) |
| `fit=contain` | `fit=pad` |
| `fit=fill` | `fit=squeeze` |
| `fit=inside` | `fit=scale-down` |
| `crop=LxTxWxH` | `trim=T;R;B;L` with the right and bottom edges computed from the oriented source size |
| `gravity` | `gravity`, same literal |
| `background` | `background=%23<hex>` |
| the format ladder | `format=auto`, one `img` with `srcset` instead of a `picture` |

## Consequences

- `parseTransform`, `renditionName` and `parseRenditionName` are the only
  code that reads or writes either grammar, and the last two are exact
  inverses.
- The cache can be inspected with `ls`, and a stray file is diagnosable by
  eye.
- No editor draws a crop rectangle or picks a focal point yet. The grammar and
  the encoder exist so the contract is fixed before any UI depends on it.
- A focal point stored on the asset record, as the media model intends, becomes
  a `gravity` on each instance at render time. No new key.
- A future output kind, a blur placeholder for instance, is a new segment
  before the extension, not a new naming scheme.
