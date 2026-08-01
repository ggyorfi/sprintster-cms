# Sprintster Request: an asset object layer over the blob store

**From:** sprintster-cms (client) · **To:** sprintster core team · **Date:** 2026-07-29

## Context

The blob store is right and we are not asking to change it. Content addressing,
immutability, dedup, byte-derived content types: keep all of it. It is the physical layer.

What is missing is the layer above it. Today an uploaded image is a hash plus a
`BlobUploaded` fact carrying `{hash, size, contentType}`, and everything else about it
(filename, dimensions, alt text) is copied inline into whichever record happens to
reference it. There is no asset as a thing.

The consequences are the ones any CMS runs into:

- The same image used in two posts has two independent alt texts and filenames. Editing
  one does not touch the other.
- Nothing lists uploads. A library built from `__blob` today shows a hash and a byte
  count: no name, no thumbnail, no usage.
- "Where is this image used" has no answer, so nothing can be safely deleted.
- There is no upload management at all: no bulk upload, no edit, no delete.

## The two layers

| layer | identity | mutability | owns |
| --- | --- | --- | --- |
| blob | content hash | immutable | bytes, size, content type |
| asset | its own id | mutable | which blob, title, alt, caption, credit, licence |

An asset **references a blob by hash**. Many assets may reference one blob; dedup stays a
blob-layer concern and is invisible above it.

## Requirements

**R1. Assets are listable.** A list of every asset, with thumbnails, search, and sort by
upload date, size and type. This is the "media library" screen, and the thumbnail grid is
the point: a text table of hashes is not usable.

**R2. Asset identity is independent of the blob hash.** The hash is a field on the asset,
not its id. Two consequences we want and cannot get otherwise: two assets may share bytes
while carrying different credit or licence, and the file behind an asset can be replaced
while its id and every reference to it survive.

**R3. Metadata lives on the asset, once.** Title, default alt text, caption, credit,
licence. We would prefer the asset object to be **config-driven like any other object**, so
a project can add its own fields, rather than a fixed built-in shape.

**R4. Records attach assets by reference.** `ref` and `refs` to an asset, so one asset can
be attached to many posts, pages and anything else. The existing referential integrity and
`refs` ordering already do what we need here.

**R5. The picker is visual, and can upload.** The current ref picker is a text typeahead
over a display field, which is unusable for images. An asset picker needs thumbnails and
search, plus an upload path inside the picker itself, because forcing an author to leave
the post, create an asset, and come back is the friction that makes people paste images
into the body instead.

**R6. Bulk upload.** Multi-select at minimum, from the list view.

**R7. "Where is this asset used", including markdown bodies.** `findBacklinks` already
answers this for `ref` and `refs`. It does not cover in-body images, which embed
`/assets/<hash>` as a plain URL. That is the extractor you described as designed but not
started; the hash is the join key between the two halves. Without both halves, delete is
unsafe.

**R8. Delete is an asset-level soft delete**, refused or clearly warned when the asset is
still referenced. Blob garbage collection stays deferred, as agreed: deleting an asset need
not delete bytes.

## Division of labour

**Ours:** the asset object definition, switching our `cover`, `ogImage` and
`defaultOgImage` fields from inline `image` to asset references, and resolving them in
`scms build`. For in-body images we resolve `/assets/<hash>` to an asset by hash, to pick up
alt and credit at render time.

**Yours:** the thumbnail list view, the visual picker, upload from inside the picker, bulk
upload, and the usage index covering markdown bodies. None of that is expressible in config
today.

## Assumptions we made, please correct

1. **Replace-in-place is required.** It is what drives R2. If you would rather assets were
   immutable and a new file always means a new asset, say so, because then the id could be
   the hash and R2 goes away.
2. **Bulk upload means multi-select**, not folder drag or archive extraction.
3. **In-body images keep the plain `![alt](/assets/<hash>)` form.** We do not want a
   sprintster-specific node in stored markdown; portability of the stored content matters
   more to us than making body images first-class references. The hash is enough to join.

## Acceptance

- An author can see every uploaded asset as a thumbnail grid, search it, and upload several
  files at once.
- An asset carries its own metadata, edited in one place, and shows where it is used across
  both reference fields and markdown bodies.
- An asset can be attached to many records, and picked or uploaded without leaving the
  record being edited.
- Deleting an asset that is still in use is refused or clearly warned about.
