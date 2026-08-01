# Sprintster Request: make `singleton: true` mean something at runtime

**From:** sprintster-cms (client) · **To:** sprintster core team · **Date:** 2026-07-26

## What we want to use

The `singleton` flag that already exists on `ObjectConfig` (`config/schema.ts:205`), applied
to the whole stack rather than to config validation alone.

Today it appears in exactly three places, none of them at runtime:

- `config/schema.ts:205` declares the boolean.
- `config/loader.ts:20` makes `lifecycle` optional for it, and `checkSingleton` requires
  every non-id field to have a default or be nullable.
- `engine/lifecycle.ts:33` is an error message.

Nothing in `api/`, `daemon/`, `web/` or `tui/` reads it. `ObjectScreen` calls
`useObjectList` unconditionally, so a singleton renders as a table with one row, and nothing
prevents a second row being created.

## Why we need it

Our CMS has a `settings` object holding site title, tagline, base URL, default OG image and
social handles. There is exactly one, forever. Two things follow:

1. **The list page is noise.** An author clicking "Site Settings" wants the form, not a
   one-row table they must then click into.
2. **A second row is a correctness problem for us, not just a UI wart.** Our static site
   generator reads site-wide values from that object. If two rows exist, the generated site
   silently depends on which one is returned first. We can defend against it by failing the
   build, but the engine is the right place to make it impossible.

## What we are asking for

1. **Open the record directly.** For `singleton: true`, skip the list and render the single
   record's default view.
2. **Enforce at most one.** Reject a create when a live record already exists, with a clear
   error rather than a silent second row.
3. **TUI parity**, since the same config drives both.

## Please reconsider the initial-value constraint

`checkSingleton` requires a default or `nullable` on every non-id field, so the record can be
served from config defaults with zero events. For a settings object that constraint works
against us: `siteTitle` and `baseUrl` are exactly the fields that should be **required**, and
giving them defaults means an unconfigured site silently builds with an empty `baseUrl`
baked into its sitemap, feed and OG tags. A wrong value that validates is worse for us than a
missing one that fails.

Two possible semantics:

- **Synthesised (current intent):** zero events, return config defaults. Needs the
  constraint, and rules out required fields.
- **Lazy creation:** no record until first save; the form opens empty and `required` fields
  behave normally. No constraint needed.

We would prefer **lazy creation**, or support for both with the constraint applying only to
the synthesised mode. If the record must exist for reads, an explicit "not configured yet"
state we can detect at build time would also work: we would rather fail a build loudly than
publish a site with placeholder settings.

## Context: the workaround we are removing

Our config currently fakes this with a hidden marker field:

```jsonc
{ "name": "singleton", "type": "text", "default": "site",
  "editable": "never", "validation": { "unique": true } }
```

It does nothing. `editable: 'never'` fields are rejected on create as unrecognized keys, so
the value is never sent, the stored row has no value for it, and the `unique` guard never
engages. We will delete it and set the object-level flag once the flag has behaviour.

## Acceptance

- An object with `singleton: true` opens its form directly in web and TUI, with no list.
- Creating a second record fails with a clear error.
- A settings object can keep `required` fields without a default.
