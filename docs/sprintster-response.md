# Sprintster Feature Requests: CMS (Core Team Response)

**From:** sprintster core team · **To:** sprintster-cms (client) · **Re:**
[`sprintster-requirements.md`](./sprintster-requirements.md)

## Summary

All four areas are **delivered**: content-editing widgets, binary image assets,
relations, and field-level features. This doc records what shipped, the
engineering decisions we made, and the open **[confirm]** items where we picked a
sensible default and need your sign-off (or a change request).

One notable change from your doc: **blob bytes are stored on the filesystem, not
in the database** (details in section 2). Everything else follows your suggested
shapes closely.

## Please confirm (checklist)

1. **[1.1] `code` language set:** we highlight `markdown`/`html`/`css`/`json` and
   fall back to plaintext for anything else. Confirm the set (we add highlighting
   for any language you name).
2. **[1.3] combo default mode:** a bare `markdown` field defaults to combo,
   opening in WYSIWYG. Confirm, or pick `wysiwyg`/`source` as the default.
3. **[1.2 / 1.3] WYSIWYG round-trip fidelity:** WYSIWYG edits may normalise
   markdown (e.g. `*` vs `_`, list markers). Source mode is guaranteed lossless.
   Confirm the normalisation is acceptable.
4. **[2.1] filesystem blob storage plus dir:** bytes live in files under
   `blobs.dir` (default `.sprintster/binary-data`), not the DB. Confirm, and for
   Postgres confirm where `blobs.dir` should point (local path or mounted
   volume).
5. **[2.2] image `width`/`height`/`alt`:** the engine stores them as optional;
   the widget captures width/height in the browser (no server-side decoding), and
   the author types alt. Confirm none need to be required.
6. **[4.1] `unique` case-sensitivity:** default is case-sensitive exact match.
   Confirm, or ask for case-insensitive (for slugs/emails).
7. **[4.2] `datetime` storage:** stored as ISO 8601 UTC, to the second. Confirm.

---

## 1. Content-editing widgets

- **1.1 `code`:** delivered. `{ "type": "code", "language": "json" }`. Syntax
  highlighting via CodeMirror 6 for markdown/html/css/json; unknown or
  `plaintext` renders without highlighting. Respects `readOnly` and
  `validation.maxLength`; value round-trips as a string. Lazy-loaded (the editor
  bundle only loads when a code/markdown field renders). See **[confirm 1]**.
- **1.2 `markdown` (WYSIWYG):** delivered via TipTap (`@tiptap/markdown`, all
  MIT). You type markdown and it formats in place; the stored value is the raw
  CommonMark string. `{ "type": "markdown", "editor": "wysiwyg" }`.
- **1.3 combo:** delivered. `{ "type": "markdown", "editor": "combo" }` (or omit
  `editor`, since combo is the default). Toggles between the WYSIWYG editor and a
  source view that reuses our CodeMirror in markdown mode. A non-editable
  markdown field renders the WYSIWYG editor read-only, i.e. a rendered preview.
  See **[confirm 2]** and **[confirm 3]**.
- **Note:** we did not embed a code-block editor inside the WYSIWYG (you have a
  better one); fenced code blocks render as plain `<pre>`.

## 2. Binary assets (images)

- **2.1 blob store:** delivered, content-addressed by sha256, idempotent (same
  bytes, same hash, stored once). **Design change:** bytes are stored on the
  filesystem as immutable files sharded by hash prefix (`<dir>/ab/cd/<hash>`,
  content type in a sibling `.type` file), not in the database, for both sqlite
  and Postgres. Rationale: keeps the DB lean, is cheap to back up and serve, and
  `BlobStore` is an interface, so an S3/R2 backend drops in later unchanged
  (matching how cloud images go to a blob service). The directory is
  per-environment `blobs.dir` (default `.sprintster/binary-data`). See
  **[confirm 4]**.
  ```jsonc
  "environments": {
    "dev": {
      "backend": { "kind": "sqlite", "path": ".sprintster/dev.db" },
      "blobs":   { "dir": ".sprintster/binary-data" }   // optional; this is the default
    }
  }
  ```
- **Event-sourcing (agreed as Option B):** every upload records a `BlobUploaded`
  fact on an internal `__blob` stream, keyed by the content hash (so re-uploads
  are idempotent: one fact per unique blob). Bytes stay outside the event log;
  the log holds the reference and the fact.
- **2.2 `image` type plus endpoints plus widget:** delivered.
  - Value shape (stored in the event payload):
    `{ "hash", "filename", "contentType", "size", "width"?, "height"?, "alt"? }`.
    Config: `{ "name": "hero", "type": "image" }`.
  - Endpoints: `POST /assets` (multipart, field name `file`) returns
    `{ hash, size, contentType, filename }`; `GET /assets/:hash` serves the bytes
    with the stored content type and `Cache-Control: public, max-age=31536000,
    immutable`.
  - Widget: upload / replace / remove, live preview via `GET /assets/:hash`, and
    an alt-text input. See **[confirm 5]** (width/height/alt are optional;
    width/height captured client-side, alt authored).
- **Responsibility boundary:** confirmed. Sprintster owns the upload widget,
  content-addressed blob storage, the `image` field type, and serving raw bytes.
  CMS owns image processing (resize, `srcset`, format conversion, HTML
  placement). GC of unreferenced blobs is deferred, as agreed.

## 3. Relations

- **3.1 multi-value ref:** delivered as a new type:
  `{ "type": "refs", "target": "tag", "display"? }` (we chose a distinct `refs`
  type over `ref` plus `multiple`). Enforces `validation.minItems`/`maxItems`;
  referential integrity is checked per element on write.
- **3.2 searchable ref picker (web):** delivered. A fuzzy typeahead with match
  highlighting, reusing the TUI's proven `fuzzyFilter` (now shared in the
  engine). Replaces the native `<select>` for both single `ref` and multi
  `refs`. Enums keep the plain select.
- **3.3 ordered relations:** delivered. Selected items render as chips with
  move-left / move-right controls; author order persists in the stored array.
- **3.4 backlinks (nice-to-have):** delivered as a read-path helper
  (`findBacklinks(objects, targetName, targetId, loadRows)`) that returns the
  objects referencing a given one via `ref`/`refs`, grouped by field. Available
  to the SSG read path; not shown in forms.

## 4. Field-level features

- **4.1 `unique`:** delivered. `"validation": { "unique": true }` on top-level
  scalar fields (rejected at config load on `id`/`sequence`/`object`/`array`/
  `refs`/`image` and nested fields). Enforced atomically via a reserved
  `__unique` stream keyed by `(object, field, value)`; respects soft-delete
  (removed rows free the value) and value changes (the old value is freed). A
  duplicate raises a clear 409 field error. See **[confirm 6]** (default:
  case-sensitive).
- **4.2 `datetime`:** delivered. `{ "type": "datetime" }`, stored as ISO 8601 UTC
  to the second; sortable in lists (lexical). See **[confirm 7]**.

## Deferred / CMS-owned (unchanged)

- **Slug generation:** CMS-owned; the `unique` guarantee it depends on
  (section 4.1) is now available.
- **Publish workflow** (draft/published/scheduled): deferred; when you want GUI
  integration it maps onto `lifecycle.statusField` plus `commands`/transitions.
- **Image processing:** CMS-owned, per the section 2 boundary.
