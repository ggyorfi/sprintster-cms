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

## Done: renditions, bake mode

Every image on the site is currently the full size original fetched through the
API proxy, so a 1600px cover ships to a phone. The seam exists and has one
implementation; this fills in the second.

- [x] **1. Encode a rendition.** sharp, from a source blob to
      `(width, format)`, with the output named as a pure function of blob hash,
      transform, width and format. The name grammar is
      [ADR 1](docs/ADR/0001-rendition-file-names.md); `renditions.ts` holds the
      encoder and the two name functions.
      *Done when:* the same input yields the same filename twice, and quality
      and formats come from `images` config rather than constants.
- [x] **2. Persistent cache outside `dist`.** Nothing re-encodes across builds
      or restarts. `images.cacheDir`, default `.scms/cache`: renditions by
      name, plus `probes.json` holding each blob's oriented size.
      *Done when:* a second run encodes nothing, and a replaced blob encodes
      only the new renditions while the old ones are left untouched.
- [x] **3. `<picture>` output.** After 1. avif and webp with the original as
      fallback, `srcset` by width, capped at the source's intrinsic width.
      `planRenditions` caps every rung inside the source, so names are known
      before encoding. Themes get raw `srcset`, `sizes` and `sources` and
      render them through `_picture.eta`.
      *Done when:* a 900px source emits no 1200 or 1920 rung, and intrinsic
      dimensions come from the oriented image rather than the stored bytes.
- [x] **4. Serve renditions at `/assets`.** After 3. Demand driven: a rendition
      is produced because a page asked for it. Only names the seam emitted in
      this process encode; a cached file is served regardless.
      *Done when:* an unreferenced library entry produces no files.

## Done: collections from config

Every route kind is hard coded today: posts, categories, tags and pages. The
first client site is a portfolio with works, exhibitions and series, and every
site after it will want its own objects. The design is
[ADR 2](docs/ADR/0002-collections-and-routes.md): an object with a slug is a
collection, and `scms.config.json` only overrides.

- [x] **1. The collection table.** Derived from the app config, then overridden
      by `collections` in `scms.config.json`, with every rule ADR 2 lists
      checked in `loadSiteConfig`.
      *Done when:* the portfolio app yields works, exhibitions, series and pages
      with no override but `page: { "path": "/" }`, and each rejected case
      names the collections involved.
- [x] **2. One resolver.** After 1. `matchRoute` and `urlFor` over collections,
      list pagination included, the `/` collection matched last, the preview
      base kept.
      *Done when:* every current route test passes with the routes expressed as
      collections, and `routes.ts` contains no object name.
- [x] **3. Publishing per collection.** After 1. The `status` and `publishedAt`
      convention, `publish` overrides, everything live under `/preview`.
      *Done when:* a draft of any object is hidden outside `/preview`, and an
      object without either field is always live.
- [x] **4. The record view model.** After 2. Refs resolved one level, images as
      picture data, `url` and `referencedBy`.
      *Done when:* an exhibition template lists its works, and a category its
      posts, with no code that names either object.
- [x] **5. Template lookup.** After 4. `<object>.eta` and `<object>-list.eta`,
      falling back to `item.eta` and `list.eta`; `home.eta` for the home record.
      *Done when:* a new object with a slug renders with the generic templates
      and no theme change.
- [x] **6. The blog as configuration.** After 5. The scaffolder writes the
      blog's collections; `routes.posts`, `categories`, `tags` and `homeSlug`
      are removed, and the loader stops fetching objects by name.
      *Done when:* the reference site serves exactly the URLs it serves today,
      checked by a test over the full route list.

## Done: languages

The app config now declares `locales`, and translated fields store one text per
locale. scms still has its own unused `langs` and `defaultLang`.

- [x] **1. One list of languages.** scms reads `locales` from `/config`;
      `langs` and `defaultLang` leave `scms.config.json`, and a config that
      still sets them gets an error naming `locales`.
      [ADR 3](docs/ADR/0003-languages-in-urls.md) records the decisions.
- [x] **2. Languages in URLs.** Decide prefixing (every language, or all but
      the default) in an ADR; the resolver adds the prefix in both directions.
      *Done when:* every page exists once per language and links stay within
      the page's language.
- [x] **3. Translated rendering.** Translated fields resolve to the page's
      language with fallback to the default; pages carry `hreflang`
      alternates.
      *Done when:* a record with no Hungarian text renders its English text on
      the Hungarian page, and nothing renders `[object Object]`.

## Done: `scms build` (feed, sitemap and robots still open)

Walk the route table, call the same renderer, write files. This is the test of
the claim that the router subsumes the generator.

- [x] **1. Route enumeration.** Every URL the site can serve, from content,
      in every language.
- [x] **2. Write the tree.** Trailing slash URLs become `index.html`, with
      `404.html`, the demanded renditions, originals that cannot be resized,
      and the theme's static files.
- [ ] **3. Feed, sitemap, robots.** Deferred out of the first serve pass.

## Next: publishing

Editors publish from the admin; a build agent anywhere with outbound internet
does the build and deploy. Built on sprintster's plugin extension points
(core ADR 13), so publishing stays a CMS concept.

- [x] **1. The publish plugin.** `sprintster-cms/publish`: a Publish action, a
      badge counting records changed since the last publish, a `publishJob`
      history, and the claim and done routes an agent uses. The log position is
      recorded when a job is claimed, before the build reads content.
- [x] **2. The build agent.** `scms agent` keeps a WebSocket open to each
      app (sprintster plugin channels, hibernating on Cloudflare), claims jobs
      over HTTP on every push and every reconnect, runs `scms build` and the
      site's deploy command, and reports back.
- [ ] **3. Running it anywhere.** A Docker image, and launchd and systemd
      examples.

## Later: `images.mode: 'url'` and a Cloudflare deploy module

Decided 2026-09-07. Static exports bake every rendition. A deploy module for
Cloudflare, opt in per site, switches the seam to URL mode: it emits
`/cdn-cgi/image/<options>/<source>` URLs from the same authored transform and
encodes nothing, and the deploy step makes the source blobs reachable. The
transform keys map mechanically: sharp fits to `cover`, `pad`, `squeeze`,
`scale-down`; the crop rectangle to `trim` edges; `gravity` and `background`
by name, which is why new keys take Cloudflare's names. With `format=auto`
URL mode emits one `img` with `srcset` rather than a `picture`; the template
never knows which.

Moved up 2026-10-24: sprintster's next epic runs the daemon on Cloudflare, with
blobs in R2. sharp is a native module and does not run on Workers, so a site
hosted there needs URL mode, or the Workers Images binding reading from R2, from
the start.

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

## Next: publishing per record

Per-record publishing and scheduled builds
([ADR 7](./docs/ADR/0007-publishing-per-record.md)), linked files served from
the blob store ([ADR 8](./docs/ADR/0008-linked-files-from-the-blob-store.md)).
Needs core's `listAt`, record actions and `blobResponse`.

- [x] **1. Published positions.** The `publication` object, the baseline (from
      the last build on upgrade), record Publish with its references, Publish
      all, the record badge and the pending count.
      *Done when:* publishing one record leaves another record's later edit
      off the site, and an upgraded site builds unchanged.
- [x] **2. Builds read published versions.** `GET /plugins/publish/records/:object`;
      preview and serve stay current.
      *Done when:* a build after an unpublished edit renders the published text.
- [x] **3. Scheduled builds.** One timer per site in the agent, set from the
      published records after each build and on connect.
      *Done when:* a published record dated a minute ahead goes live with no
      Publish press, and two dates give two builds.
- [x] **4. Linked files from the blob store.** `linkedFiles: "blob-store"`
      writes `_files.json` instead of copies; the site Worker and `scms serve`
      serve the listed paths.
      *Done when:* a linked file downloads from the built site and an unlisted
      hash does not.

## Next: publication states and scheduling

[ADR 9](./docs/ADR/0009-publication-states-and-scheduling.md).
Needs core ADR 25.

- [x] **1. Dates and states.** `publishedAt`, `lastPublishedAt`, `scheduledAt`
      and `scheduledPosition` on publication rows; published, scheduled and
      pending worked out from them; any edit drops a schedule; first dates of
      older records from their own `publishedAt` or `createdAt`.
      *Done when:* a scheduled record goes live at its date and an edit before
      it makes the record pending again.
- [x] **2. Admin.** The state column (green, yellow, red), the Publish row
      button and dialog (now or a date), `status` and `publishedAt` gone from
      forms.
      *Done when:* an editor publishes or schedules from the list.
- [x] **3. Builds and the agent.** The build route adds `publishedAt` and
      `lastPublishedAt`; the agent's timer follows the plugin's next
      `scheduledAt`.
      *Done when:* tanarblog sorts by first publish date with no `publishedAt`
      field on its articles.

## Next: published snapshots and the agent's copy

[ADR 10](./docs/ADR/0010-published-snapshots-and-the-agent-copy.md). Needs
core's paged lists and pinned snapshots.

- [x] **1. Published set.** Publishing, Publish all, maintenance and published
      deletes pin and unpin; due schedules pinned when a build is claimed; the
      records route paged over the set; `GET /plugins/publish/changes`.
      *Done when:* a build reads published records page by page from the set.
- [x] **2. The agent's copy.** Stored per site with its sequence, updated from
      the changes, rebuilt in full when missing or unknown.
      *Done when:* a second build of tanarblog fetches only what changed.
- [x] **3. scms reads page by page.** Preview and `scms serve` through
      `listAll`.
      *Done when:* no scms read asks for a whole object at once.

## Next: images written as HTML

[ADR 11](./docs/ADR/0011-html-images.md).

- [x] **1. Build.** An HTML `<img>` of `/assets/<id>` shows the record's
      linked file.
      *Done when:* tanarblog's imported articles show their images on the site.
- [x] **2. Admin editor.** Shows those images from the API.
      *Done when:* an imported article's images show in the editor.

## Next: rebuilding the published set

[ADR 12](./docs/ADR/0012-rebuilding-the-published-set.md).

- [x] **1. A set left behind.** The marker pinned in the store; a marker
      without its pin builds the set again.
      *Done when:* tanarblog moved by `s8r export`/`import` publishes its
      articles without an extra step.
- [x] **2. Rebuild on request.** `POST /plugins/publish/rebuild`, confirmed by
      the app title; tenants: admin only, `just rebuild <site> <dev|prod>`.
      *Done when:* a rebuild from the laptop refreshes the agent's copy.
