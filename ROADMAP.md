# Roadmap

`scms` is a Markdown oriented CMS on top of sprintster. It reads content only
over the daemon HTTP API, never the database. The design decisions behind the
work below are in [docs/media-model.md](docs/media-model.md) and
[docs/topology.md](docs/topology.md).

## Done

- **The read client.** Health gated `connectDaemon`, typed `rows()`, the
  `assets` pointer from `/config`, source blobs by hash.
- **`scms serve`.** Site at `/`, admin proxied at `/admin`, daemon proxied at
  `/api`, drafts and future dated records visible only under `/preview`.
- **The route table.** One resolver in both directions, so a previewed page
  links inside `/preview` without a second code path.
- **The default theme.** eta templates, a Liquid named filter registry, a view
  model shaped like Jekyll's, markdown with the image seam in place.

## Next: renditions, bake mode

Every image on the site is currently the full size original fetched through the
API proxy, so a 1600px cover ships to a phone. The seam exists and has one
implementation; this fills in the second.

- [ ] **1. Encode a rendition.** sharp, from a source blob to
      `(width, format)`, with the output named as a pure function of blob hash,
      transform, width and format.
      *Done when:* the same input yields the same filename twice, and quality
      and formats come from `images` config rather than constants.
- [ ] **2. Persistent cache outside `dist`.** Nothing re-encodes across builds
      or restarts.
      *Done when:* a second run encodes nothing, and a replaced blob encodes
      only the new renditions while the old ones are left untouched.
- [ ] **3. `<picture>` output.** After 1. avif and webp with the original as
      fallback, `srcset` by width, capped at the source's intrinsic width.
      *Done when:* a 900px source emits no 1200 or 1920 rung, and intrinsic
      dimensions come from the oriented image rather than the stored bytes.
- [ ] **4. Serve renditions at `/assets`.** After 3. Demand driven: a rendition
      is produced because a page asked for it.
      *Done when:* an unreferenced library entry produces no files.

## Then: `scms build`

Walk the route table, call the same renderer, write files. This is the test of
the claim that the router subsumes the generator.

- [ ] **1. Route enumeration.** Every URL the site can serve, from content.
- [ ] **2. Write the tree.** Trailing slash URLs become `index.html`.
- [ ] **3. Feed, sitemap, robots.** Deferred out of the first serve pass.

## Deferred

- **Syntax highlighting with shiki.** Fenced code blocks render as plain `<pre>`
  today. shiki is already a dependency, uses TextMate grammars and emits HTML
  with inline colours so no JavaScript ships to the browser. It loads grammars
  asynchronously and is expensive to start, so it has to be created once and
  shared rather than per render. Worth doing when a site actually publishes
  code, and worth dropping from dependencies if none does.
- **The two invariant checks** from the media model: reject an `image` property
  outside the assets object, and reject a body URL pointing at a blob hash. The
  second is enforced at render today and throws; it belongs in a check that runs
  over all content at once.
- **An explicitly empty alt.** `![]()` currently means "inherit the record's
  alt", so a decorative image cannot say it wants no description. Case 9 of the
  media model.
- **Images reached through a `ref`** (`cover`, `ogImage`) carry no instance
  data, so they can only fall back to the record.

## Waiting on sprintster

- **CORS**, before the admin and API can sit on different origins.
- **A body side asset picker**, so a second use of one photo is a second
  instance rather than a second record. Step 5 of the visual collection views
  epic.
- **The reference index**, before removal can say what still points at a record,
  and before records can safely dedup by content hash.
