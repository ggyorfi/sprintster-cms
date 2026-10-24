# Media model: blob, asset record, embed instance

Decided 2026-08-26, before starting the static site generator. This is the CMS
side of the record. The sprintster side of it is ROADMAP step 5 of the visual
collection views epic, and the blob collection entry under the reference index
epic.

## Three layers

| layer | identity | mutable | holds |
| --- | --- | --- | --- |
| blob | sha256 of its own bytes | no, by construction | the bytes |
| asset record | uuid | yes | one blob ref plus editorial facts |
| embed instance | a pointer in a body or a `ref` property | with the content around it | contextual intent |

Sprintster's own word for layer 1 is *blob*, and it serves it at
`/assets/<hash>`. Our object for layer 2 is named `asset` and routed `media`,
because `assets` is a reserved route in the engine. The word "asset" therefore
does double duty today.

**Open:** renaming our object to `media` (name and route both), so the pointer
reads `assets: 'media'` and the layers read blob / media / instance with no term
reused. Cheap now, annoying later. Not yet decided.

## Cardinality

- asset to blob is 1:1 at any instant, 1:N across history, because replacing an
  image repoints the record at a new blob and the event store keeps the old ref.
- blob to asset is 1:N. Dedup is by hash, so two authors uploading the same
  photo silently share one blob under two records.
- instance to asset is M:1.

## What lives where

The rule is **instance > record > blob, and nothing is ever copied downward.**
Copying is precisely what breaks a credit correction and a replacement.

**Blob, intrinsic, derivable from the bytes.** Content type, byte size, oriented
pixel width and height. Orientation matters: a rotated JPEG must render upright,
so the dimensions we use are the oriented ones, and the ladder cap depends on
them.

**Asset record, facts about the picture.** Title, a default alt, caption,
credit, and a focal point so a portrait always crops around the face. These are
single source of truth: a credit correction must land in one place, and a
replaced file must reach every reference.

**Embed instance, intent for this use.** Alt for this context, target width and
fit, role (thumbnail, hero, float right), and whether a caption is shown.
The same photo in two articles means two different things and needs two
different alts, which is why alt is instance level with the record supplying a
default. The editor already stores alt as an attribute on the image node rather
than on the record, so this matches what is built.

**Neither.** The responsive ladder. `images.widths`, `images.formats` and
`images.quality` are build config, identical for every image, never authored.

### Two cases the precedence rule does not settle

1. **Explicitly empty alt.** A decorative divider needs alt to be empty, which
   is not the same as unspecified. Two states (present, absent) are not enough,
   and the editor initialises alt to `''`, so the distinction is live today.
2. **Refs carry no instance layer.** An image reached through a `ref` property
   (`cover`, `ogImage`) has nowhere to put alt or intent, so it can only fall
   back to the record. Either we accept that ref based images are record only,
   or refs need somewhere to carry intent.

## Locator

A body image is authored as:

```
![Harbour at dawn](/assets/<record id>?width=600,fit=cover)
```

The record id form is ADR 10. The transform goes in the **query**, not in a path
segment, for one practical reason: the daemon serves `/assets/<id>` and ignores
an unknown query, so the WYSIWYG preview keeps working today. A path form such
as `/media/width=600/<id>.avif` would show a broken image until something serves
it.

The transform grammar is comma separated `key=value`, taken from the earlier
media service prototype and finalised against Cloudflare's URL schema in
[ADR 1](ADR/0001-rendition-file-names.md): `width`, `height`, `fit`, `crop`,
`gravity`, `background`. The same authored string is read by both rendition
modes below, which is what makes baking a strategy rather than the
architecture.

Verified by reading `packages/web/src/ui/MarkdownEditor.tsx`: the image node
serialises `![alt](src)` from `attrs.src` through `storedAssetUrl`, which only
strips the origin prefix, so a query string survives the WYSIWYG round trip.
Confirmed by reading the serialiser, not by running the editor.

## Renditions

v1 generates everything at build time. A dynamic media endpoint with CDN caching
is a later alternative, not a prerequisite.

The fan out is per distinct rendition, not per image: four widths times two
formats plus the original is nine files per instance, and one photo used three
ways is twenty seven. At a few hundred images that reaches thousands of files,
which meets real host limits, and avif encoding is seconds per large image, so a
cold build is the pain rather than disk.

Four guards make build time generation the right default:

1. **Demand driven.** Generate only renditions the emitted HTML references. An
   unreferenced library entry then costs nothing.
2. **Content addressed output plus a persistent cache outside `dist`.** The
   filename is a pure function of (blob hash, transform, width, format), so
   identical renditions collapse across instances and across builds, and only
   genuinely new images encode.
3. **Never upscale.** Cap the ladder at the source's intrinsic width.
4. **One seam.** A single function takes (asset record, instance intent, ladder
   config) and returns the `<picture>` markup. No template, no markdown rule and
   no other part of the generator constructs an image path. In bake mode it
   encodes and returns local paths; in a later `images.mode: 'url'` it returns
   CDN URLs and encodes nothing.

Renditions are keyed on the blob hash, so a replacement makes old renditions
simply stop being requested. Nothing in the cache goes stale, which is what makes
the persistent cache safe.

## Invariant: only the asset record touches a blob

Everything in the system points at record ids. `asset.file` is the only place
holding a blob ref.

`post.cover`, `page.ogImage` and `settings.defaultOgImage` are refs and already
comply, and ADR 10 moved body images to record ids. What could violate it is a
stray `image` property on another object, since the engine's `image` type is
generic and any object may declare one. The engine will not forbid that, and
should not: a plain `user.avatar` is a legitimate shape for an app with no media
library. Enforcement is therefore ours, in three checks, with no engine change:

1. `scms build` rejects a config with an `image` property outside the assets
   object.
2. `scms build` rejects a body URL of the form `/assets/<64 hex>`. A hand
   authored hash URL is the one remaining way to point past the record layer.
   There is no legacy fallback: the CMS has never shipped, so no such data
   exists.
3. The scaffold declares exactly one image property, which it already does.

The payoff is that blob reachability becomes computable from the asset records
alone, which turns a future collector from a scan over every property of every
object into a scan of one object.

## Deliberately not in v1

- **Licence.** Dropped. It was also the case that forced two records for one
  blob, so record per blob multiplicity is now possible but not required.
- **Record level hash dedup.** Two uploads of one file share the blob, not the
  record, so replacing one article's image cannot silently change another's.
  `attachAsset` mints a fresh record per insert, so this already holds. The cost
  we accept is duplicate library entries and a credit fix landing twice. The
  move once referrers can be listed is copy on write replace: "replace
  everywhere, here is what it affects" versus "detach and replace only here".
- **Blob garbage collection.** Recorded as an open question in the sprintster
  reference index epic. It has to know every blob reference site; our invariant
  narrows that, for this CMS, to the asset object.
- **A body side picker.** Today the only way to put an image in a body is to
  upload one, so every body image is a new record. Added as step 5 of the visual
  collection views epic in sprintster.
