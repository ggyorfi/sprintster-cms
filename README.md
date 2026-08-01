# sprintster-cms

Monorepo for a Markdown-oriented static site CMS built on sprintster.

## Packages

| Package | Publishes | What it is |
| --- | --- | --- |
| `packages/sprintster-cms` | `sprintster-cms` (bin `scms`) | the CMS: static site generator and project commands |
| `packages/create-sprintster-cms` | `create-sprintster-cms` | scaffolder for new sites |

A generated site depends on exactly two packages: `sprintster` for the `s8r` daemon, TUI
and web GUI, and `sprintster-cms` for `scms`.

## Development

```
pnpm ref     # rebuild everything and regenerate examples/reference-site
pnpm seed    # fill the reference site with deterministic content
pnpm test    # run every package's tests
```

`examples/reference-site` is gitignored and disposable: it is pure scaffolder output, so
regenerating it proves the scaffolder still works. `pnpm ref` also rebuilds the linked
sprintster checkout, because `link:` resolves built output and a stale bundle silently runs
old core code.

Set `SPRINTSTER_REPO` if your sprintster checkout is not a sibling of this one.

To work on the reference site:

```
cd examples/reference-site
pnpm exec s8r daemon    # API and web GUI on the configured port
pnpm exec scms reset    # wipe its store and blobs
```

The CMS reads content only over the daemon's HTTP API, so the daemon must be running for
`scms build`.
