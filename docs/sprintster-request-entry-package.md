# Sprintster Request: unscoped `sprintster` entry package

**From:** sprintster-cms (client) · **To:** sprintster core team · **Date:** 2026-07-19
**Related:** [`sprintster-requirements.md`](./sprintster-requirements.md) section 4.3

## Context

We adopted a "friendly entry package" pattern on our side: a sprintster-cms
project depends on one package, **`sprintster-cms`**, which owns the **`scms`**
binary and pulls the CMS toolchain in transitively. We would like sprintster core
to mirror this so a project needs just two top-level dependencies:

```jsonc
"dependencies": {
  "sprintster": "^x.y.z",      // gives the `s8r` binary + engine/storage/tui/web
  "sprintster-cms": "^x.y.z"   // gives the `scms` binary (ours)
}
```

Today the `s8r` binary lives in the **scoped** `@sprintster/cli`. Package-manager
bins of transitive dependencies are not exposed to the project, so the package a
project depends on **directly** must be the one that owns `s8r`. Hence the ask.

## The request

Publish an **unscoped `sprintster`** package that:

1. Owns the `s8r` binary: `"bin": { "s8r": "./dist/index.js" }`.
2. Depends on the runtime toolchain (`@sprintster/engine`, `@sprintster/daemon`,
   `@sprintster/tui`, `@sprintster/web`, `@sprintster/storage-sqlite`,
   `@sprintster/storage-postgres`) so a single `pnpm add sprintster` is enough.

### Two ways to do it (your call)

- **Option A (recommended): rename `@sprintster/cli` to `sprintster`.** The bin
  stays `s8r`. Optionally keep `@sprintster/cli` as a deprecated alias that
  re-exports, for any existing installs.
- **Option B: thin wrapper.** Keep `@sprintster/cli`; add a new `sprintster`
  package whose own `bin/s8r.js` re-exports the CLI entry and that depends on
  `@sprintster/cli`. (A wrapper must declare its **own** bin file; it cannot
  inherit the dependency's bin.)

We recommend A: one package, no indirection.

## Version alignment

Our `sprintster-cms` package reads the engine's data at build time, so it depends
on `@sprintster/engine` too. To keep the two project-level deps from drifting,
please keep `@sprintster/engine` a normal dependency of `sprintster` with a clear
semver line; we will track the same major. (If you would rather enforce it, a
peer dependency on `@sprintster/engine` works for both of us.)

## Acceptance

- `pnpm add sprintster` in an empty project yields a runnable `s8r`
  (`pnpm exec s8r --help` works).
- The project does not need to name `@sprintster/engine` or any storage package.
- Existing `@sprintster/cli` consumers keep working (if you take Option A, via the
  alias).

## What we change on our side once it lands

- Scaffolder published-mode deps become `sprintster` + `sprintster-cms` (already
  the default our generator emits).
- Our `--local` dev mode links the new `sprintster` package path instead of
  `@sprintster/cli`.
