# Topology: site, admin, API, assets

Decided 2026-08-27, alongside the move from a generator-first to a
router-first CMS. Companion to [media-model.md](media-model.md).

## The four surfaces

| surface | dev | production |
| --- | --- | --- |
| site | `/` | `mysite.com` |
| admin | `/admin` | `admin.mysite.com` |
| API | `/api` | `api.mysite.com` |
| assets | `/assets` | `assets.mysite.com` |
| preview | `/preview` | a mode, not an origin |

`scms serve` is the front door in dev. It owns `/`, proxies `/api/*` to the
sprintster daemon with the prefix stripped, and serves the admin bundle under
`/admin`. **No sprintster change is required for this.**

## Why the site cannot share the daemon's root

Object routes are mounted at the root of the daemon: `pages`, `posts`,
`categories`, `tags`, `media`, `menu`, `settings`, plus `health`, `config` and
`assets`. The site wants `/categories/<slug>` and `/tags/<slug>`, which collide
head on, and since page URLs are flat by slug, any page slugged `posts` or
`settings` collides too. Putting the API behind a prefix removes the whole class
of collision at once.

## Why this is cheap

- **The admin SPA claims no paths and follows its mount point.** It routes on
  a query parameter (`?ctx=`), and since sprintster ADR 12 it derives its asset
  and API base from the URL it was served at. The host's whole job is to serve
  the shell at `/admin/` and forward `/admin/*` to the daemon with the prefix
  stripped. No router rebasing, no bundle bridging.
- **The API prefix already exists.** `resolveApiBaseUrl` returns
  `VITE_API_URL ?? ''` and dev already sets `/api` with a Vite proxy that strips
  it. A full URL is supported for the split origin case.
- **Asset URL round tripping already works.** `assetUrl` returns
  `${apiBase}/assets/<id>`, so the editor previews from `/api/assets/...`, and
  `storedAssetUrl` strips the base back to `/assets/<id>` before storing. The
  stored form stays root relative and environment independent.

## Source blobs versus renditions

These are different things and get different origins.

- **Source blobs** are the originals, served by the daemon at
  `/api/assets/<id>` (record) and `/api/assets/<hash>` (blob). They are what the
  editor previews. They live behind the API origin.
- **Renditions** are derived, immutable and content addressed, served at
  `/assets/...`, and are the ones that belong on `assets.mysite.com`. A separate
  origin is cookieless, so rendition requests carry no auth, and it can be
  repointed at R2 or a CDN without touching the application.

The renderer rewrites a stored `/assets/<id>` into a rendition URL identically in
dev and production, through the single seam described in the media model. There
is no dev special case.

## Preview is a mode

`/preview` is the same renderer with a different content filter: drafts
included, future dated posts included, which is exactly what the public site
omits. It is a flag threaded through the renderer, not a parallel code path,
otherwise the two drift. In production it becomes a signed token or its own
origin rather than a path.

## The load bearing rule

**Nothing constructs a URL except one resolver.** This is now the third instance
of the same pattern, after the rendition seam and the API base URL, and it is
what keeps the dev layout (paths on one origin) and the production layout (four
origins) a configuration difference rather than a rewrite. A previewed page
linking to `/preview/blog/x` rather than `/blog/x` falls out of the same
resolver.

## Known gap on the sprintster side

The daemon has **no CORS**, no middleware and no headers anywhere in
`packages/daemon` or `packages/cli`. Same origin hides this today. The moment
the admin is on a different origin from the API, every write fails on preflight.
This is generic for any sprintster app deployed with a separate API origin, so
it belongs in the engine with an allowed origins setting, not in our layer.

Subdomains rather than separate domains also matter later: `admin.mysite.com`
talking to `api.mysite.com` stays same site under one registrable domain, so
cookie auth works with plain `SameSite=Lax`.
