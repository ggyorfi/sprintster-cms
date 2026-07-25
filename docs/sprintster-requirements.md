# Sprintster Feature Requests: CMS

**From:** sprintster-cms (client) · **To:** sprintster core team · **Date:** 2026-07-18

## Summary

We are building a Markdown-oriented, single-tenant, static-site CMS on top of
sprintster. Data and binary assets are stored locally. Below are the engine,
widget, and storage features we need, grouped by area. Each item states **what**,
**why**, a **suggested shape**, and **acceptance**. Items marked _CMS-owned_ are
listed only to clarify the boundary: we build those, not you.

Requested, in priority order:

1. **Content-editing widgets:** code editor, Markdown WYSIWYG, and a combo
   editor that toggles WYSIWYG to source.
2. **Binary assets:** extend the storage interface with a content-addressed blob
   store; add an `image` property type plus upload widget plus daemon endpoints.
3. **Relations:** multi-value refs, a searchable ref picker, ordered relations,
   and (nice-to-have) reverse/backlink relations.
4. **Field-level:** field-level `unique` validation and a `datetime` property type.

Open assumptions needing a confirmation from us are marked **[confirm]**.

---

## 1. Content-editing widgets

All three store a **plain string** value (no rich binary payload), which keeps
the event log clean and the content portable to the static generator.

### 1.1 Code editor with syntax highlighting: new property type `code`
- **What:** a code-editing widget with syntax highlighting (line numbers, mono
  font, bracket matching).
- **Why:** editing raw snippets (HTML/CSS/JSON embeds), and serving as the
  *source mode* for 1.3.
- **Suggested shape:**
  ```jsonc
  { "name": "snippet", "type": "code", "language": "markdown" } // language configurable
  ```
  Default languages we need: `markdown`, `html`, `css`, `json`, `plaintext`. **[confirm]** language set.
- **Acceptance:** value round-trips as a string; `language` drives highlighting;
  respects `readOnly` and `validation.maxLength`.

### 1.2 Markdown WYSIWYG editor: new property type `markdown`
- **What:** a what-you-see-is-what-you-get Markdown editor. Stored value is the
  **raw Markdown string**, not HTML.
- **Why:** primary authoring surface for page/post bodies; raw MD keeps the SSG simple.
- **Suggested shape:** `{ "name": "body", "type": "markdown" }`
- **Acceptance:** typing produces valid CommonMark; supports headings, bold/italic,
  links, lists, code blocks, and images (image insertion ties into section 2); value
  stored as MD text.

### 1.3 Combo editor (WYSIWYG to source): composes 1.1 and 1.2
- **What:** the `markdown` widget with a toggle between WYSIWYG (1.2) and a raw
  **source** view rendered by the code editor (1.1) in Markdown mode.
- **Why:** this is the "MD editor with 2 modes" we originally asked for; authors
  switch to source for precise control.
- **Suggested shape:** same `markdown` property type with a widget option, e.g.
  `{ "type": "markdown", "editor": "combo" }` (vs `"wysiwyg"` or `"source"`). **[confirm]** default mode.
- **Acceptance:** toggling modes preserves content losslessly (round-trips MD to MD).

---

## 2. Binary assets (images)

**Design decision (agreed):** keep event sourcing clean by making blobs
**content-addressed** (addressed by content hash). Events store only a blob
reference plus metadata; the bytes live outside the event log and are
**immutable**, so historical events and projections never break when content
changes. Archiving of unreferenced or old blobs is out of scope for now.

### 2.1 Storage-interface extension: content-addressed blob store
- **What:** extend the storage abstraction so each `storage-*` package persists
  binary data alongside events. Bytes keyed by content hash (e.g. sha256).
- **Where:** `storage-sqlite` writes to `.sprintster/binary-data/` (next to
  `dev.db`); `storage-postgres` chooses its own mechanism (bytea, large object, or fs). **[confirm]** pg approach.
- **Suggested shape:** add a sibling interface to `EventStore`
  (`packages/engine/src/events/store.ts`):
  ```ts
  export interface BlobStore {
    putBlob(bytes: Uint8Array, contentType: string): Promise<{ hash: string; size: number }>;
    getBlob(hash: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
    hasBlob(hash: string): Promise<boolean>;
  }
  ```
  Implement in `InMemoryEventStore` (in-memory map), `storage-sqlite`, and
  `storage-postgres`. Content-addressing gives free dedupe and idempotent writes.
- **Acceptance:** putBlob is idempotent for identical bytes; getBlob returns bytes
  plus content type; blobs survive daemon restarts; no bytes stored in the event stream.

### 2.2 `image` property type plus upload widget plus endpoints
- **What:** a first-class property whose value is a **reference to a blob** plus
  display metadata; a form widget to upload/replace/clear; daemon HTTP routes for
  the widget to POST bytes and GET them back.
- **Suggested value shape** (stored in event payload):
  ```jsonc
  { "hash": "sha256:…", "filename": "hero.png", "contentType": "image/png",
    "size": 12345, "width": 1600, "height": 900, "alt": "" }
  ```
  Config: `{ "name": "hero", "type": "image" }`. **[confirm]** whether width/height/alt
  are captured by the engine or left to us.
- **Endpoints:** `POST /assets` (multipart to `{hash,…}`), `GET /assets/:hash` (bytes).
- **Acceptance:** uploading in a form stores a reference; the image renders in the
  view and in list cells; deleting the object leaves the blob (GC deferred).

### Responsibility boundary
- **Sprintster owns:** upload widget, blob storage plus content-addressing, the
  `image` field type, serving raw bytes.
- **CMS owns (_CMS-owned_):** image *processing*, i.e. resize, `srcset`, format
  conversion, and placement in generated HTML.

---

## 3. Relations

`ref` today is a single forward reference. In the **TUI** it already has a
searchable, fuzzy-filtered picker with match highlighting
(`packages/tui/src/components/Picker.tsx`, via `fuzzyFilter`). The **web** ref
widget, however, is still a plain native `<select>` (`Select.tsx`) that loads all
options and cannot filter. We need:

### 3.1 Multi-value reference
- **What:** a property holding an ordered set of refs to a target object
  (post to many tags/categories).
- **Suggested shape:** `{ "name": "tags", "type": "ref", "target": "tag", "multiple": true }`
  (or a `refList` type, your call).
- **Acceptance:** stores/edits N references; enforces `validation.minItems/maxItems`.

### 3.2 Searchable ref picker on the web (TUI parity)
- **What:** bring the TUI's fuzzy-filter picker behavior to the web ref widget:
  a typeahead that filters target rows by their `display` field, replacing the
  plain `<select>`.
- **Why:** the web `<select>` is unusable past a few dozen rows; the TUI already
  solves this (`Picker` + `fuzzyFilter`), so this is a parity gap, not new design.
- **Acceptance:** typing filters options with match highlighting; works for
  single (3.0) and multi (3.1) refs; behavior matches the TUI picker.

### 3.3 Ordered relations
- **What:** manual ordering of a multi-value ref (drag/reorder), order persisted.
- **Why:** menus, galleries, curated collections.
- **Acceptance:** author-defined order is stored and returned stably.

### 3.4 Reverse relations / backlinks: _nice-to-have_
- **What:** read-only derived list of objects that ref this one
  ("all posts in this category").
- **Acceptance:** available to the SSG read path even if not shown in the form.

---

## 4. Field-level features

### 4.1 Field-level `unique` validation
- **What:** a `unique: true` validation rule enforcing uniqueness of a field's
  value across live records of an object.
- **Why:** slugs, emails. Note: the existing `UniqueViolationError` is
  **stream-version** concurrency only; there is no business-field uniqueness today.
- **Suggested shape:** `"validation": { "unique": true }`; enforce via a
  uniqueness projection/index keyed by `(object, field, value)`, reusing
  `UniqueViolationError` semantics at the field level; must respect soft-delete
  (`removed`) so deleted records free the value. **[confirm]** case-sensitivity.
- **Acceptance:** creating/editing to a duplicate value is rejected with a clear
  field error; soft-deleted rows do not block reuse.

### 4.2 `datetime` property type
- **What:** date **and** time (today only `date` exists).
- **Why:** publish timestamps and scheduling.
- **Suggested shape:** `{ "name": "publishedAt", "type": "datetime" }`, stored as
  ISO 8601 UTC; widget is a date plus time input. **[confirm]** UTC storage.
- **Acceptance:** round-trips to the second; sortable in lists.

### 4.3 Unscoped `sprintster` entry package (packaging)
- **What:** publish an unscoped **`sprintster`** package that owns the `s8r` bin
  and pulls in the toolchain (engine, storage, tui, web) as its own dependencies,
  so `pnpm add sprintster` is all a project needs for core.
- **Why:** a sprintster-cms project should list just two friendly top-level deps,
  `sprintster` (gives `s8r`) and `sprintster-cms` (gives `scms`), instead of
  wiring `@sprintster/cli` plus its sub-packages by hand. Bins of transitive deps
  are not exposed to the project, so the package that owns `s8r` must be the one
  the project depends on directly; today that is the scoped `@sprintster/cli`.
- **Suggested shape:** either rename/alias `@sprintster/cli` to `sprintster`, or
  publish a thin `sprintster` package whose `bin.s8r` re-exports the CLI entry.
- **Acceptance:** `pnpm add sprintster` yields a runnable `s8r`; no need to name
  `@sprintster/engine` or storage packages in the project. Until then our
  scaffolder links `@sprintster/cli` directly under `--local`.

---

## Deferred / CMS-owned (not requested from sprintster)

- **Slug generation:** URL-safe slug derived from title. _CMS-owned_, but depends
  on **4.1 unique** to guarantee no collisions.
- **Publish workflow** (draft/published/scheduled): handled for now by our
  `scms` CLI. Sprintster GUI integration (via `lifecycle.statusField` plus
  `commands`/transitions) deferred to a later round.
- **Image processing:** resize/srcset/format conversion, per the section 2 boundary.

---

## Appendix: current sprintster state (for reference)

- **Property types:** `id, text, enum, money, integer, date, ref, boolean,
  sequence, object` (nested), `array` (repeating group).
- **Widgets:** text to `TextField` (single/multiline via `rows`); enum and ref to
  native `Select`; date to native date input.
- **Storage:** `EventStore` (`append`, `findByStream`, `findByStreamType`,
  `streamHead`); implementations: `InMemoryEventStore`, `storage-sqlite`
  (`.sprintster/dev.db`), `storage-postgres`.
- **Uniqueness today:** stream-version concurrency only (`UniqueViolationError`).
