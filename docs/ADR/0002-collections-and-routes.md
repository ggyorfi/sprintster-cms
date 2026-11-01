# 2. Collections and routes from config

Date: 2026-11-01

## Status

Accepted. Replaces the fixed route kinds in `routes.ts` and `content.ts`.

## Context

The router knows four kinds of page by name: posts, categories, tags and pages.
`scms.config.json` can rename their prefixes and nothing else, and the content
loader fetches those objects by name. A portfolio needs `/works/<slug>` and
`/exhibitions/<slug>`, and the next site will need something else again. Each
new object type would be a code change in the router, the loader, the view
model and the theme.

The rule this ADR sets: adding an object type to a site is a config change, and
in the common case not even that.

## Decision

### A collection is an object with a slug

Every object in the app config that has a top-level `text` property named
`slug` is a collection. It gets:

- a list page at its path, paginated when it holds more records than
  `pagination.perPage`: `<path>/`, `<path>/page/2/`, ...
- a detail page per record at `<path>/<slug>/`.

Objects without a slug (assets, menu items, settings) are not collections and
get no pages. They are still available to templates as data.

### `scms.config.json` only overrides

```json
"collections": {
  "page": { "path": "/", "home": "home" },
  "post": { "path": "/blog", "sort": "-publishedAt", "perPage": 10 },
  "work": { "sort": "-date" },
  "series": false
}
```

| key | default | meaning |
| --- | --- | --- |
| `path` | `/<object route>` | the URL prefix: `/`, or lowercase segments each after a slash, e.g. `/blog`, `/en/works`; no trailing slash |
| `sort` | creation order | a property name, `-` in front for descending |
| `perPage` | `pagination.perPage` | records per list page |
| `home` | none | on the `/` collection only: the slug of the record rendered at `/` |
| `list` | `true` | `false`: no list pages, only record pages |
| `publish` | see below | which records are live |
| `false` | | the collection gets no pages |

`loadSiteConfig` rejects a malformed path when it reads the file. The rest
needs the app's objects, so it is checked when scms connects to the daemon,
before the first page is served, with the offending names in the message:

- a key that is not an object in the app config, or an object without a slug;
- a malformed path, two collections on one path, or a path equal to or inside
  a server prefix (`/admin`, `/api`, `/assets`, `/preview`);
- a path inside another collection's path (`/blog` and `/blog/archive`),
  because `/blog/archive/` would also be a detail URL under `/blog`;
- more than one `/` collection, or `home` outside it.

### One resolver, both directions

`matchRoute(url)` returns a collection and either a list page number or a slug;
`urlFor(record)` and `urlFor(collection, page)` build the inverse. The `/`
collection is matched last, so `/works/` is never read as a page slugged
`works`. The `/` collection has no list page: `/` shows its `home` record. A record slugged `page` under a paginated list is shadowed by
pagination, as today. Templates and the markdown renderer only build links
through `urlFor`, so a path change moves every link with it.

### Publishing is a convention

A record is live when, if its object has them, `status` is `published` and
`publishedAt` is not in the future. `publish: { "status": "<value>", "date":
"<property>" }` names a different field or value, and `publish: false` makes
every record live. Under `/preview` every record is live, as today.

### One record shape for templates

A detail template receives the record with:

- translated fields resolved to the page's language, falling back to the
  default (see the languages step);
- `ref` and `refs` resolved one level deep to records, and images to the
  `<picture>` data `_picture.eta` already takes;
- `url`, from the resolver;
- `referencedBy`, the live records of other collections that point at it,
  grouped by object: an exhibition lists its works, a category its posts.

A list template receives the page of records in the same shape as `records`,
plus `paginator`. Every template also receives `data`: the live records of every
object by name, a singleton as its one record, so a layout reads site settings
and menus without the view model knowing either object.

### Template lookup

`<object>-<slug>.eta` for one record, then `<object>.eta` for a detail page
and `<object>-list.eta` for a list, falling back to the theme's generic
`item.eta` and `list.eta`. Records also carry `$raw`, their markdown before
rendering, and templates get a `markdownify` filter, so a theme can rewrite a
body before rendering it. The home record renders
with `home.eta` when the theme has one. A theme therefore only adds files for
the objects it wants to style differently.

### The blog becomes configuration

`posts`, `categories`, `tags` and `homeSlug` leave `routes`; the scaffolder
writes the equivalent `collections` instead, and the router, loader and view
model lose every object name.

## Consequences

- A new object with a slug appears on the site with the generic templates, before
  anyone writes a theme file for it. Hiding one takes `false`.
- The reference site's URLs must not change: the scaffolder's collections
  reproduce today's routes exactly, and a test lists them.
- `referencedBy` costs one pass over all collections per build. Fine at
  portfolio and blog sizes; revisit if a site has tens of thousands of records.
- Nested collections (`/works/<series>/<slug>`) are out of scope. A path is a
  prefix, and the slug is always its last segment.

## Open

- How languages appear in URLs: every language prefixed (`/en/`, `/hu/`), or
  the default unprefixed. Decided in the languages step.
