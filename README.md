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

Set `SPRINTSTER_REPO` if the sprintster checkout is not at `../core`.

To work on the reference site:

```
cd examples/reference-site
pnpm dev                # daemon + site on http://localhost:4000
pnpm exec s8r daemon    # API and web GUI on the configured port
pnpm exec scms reset    # wipe its store and blobs
```

The CMS reads content only over the daemon's HTTP API, so the daemon must be running for
`scms build`.

## Commands

```
scms dev      # daemon and site on one origin
scms serve    # site, admin and API against a running daemon
scms build    # write the static site to outDir (default dist)
scms agent    # build and deploy sites when their admin asks to publish (scms.agent.json)
scms reset    # wipe local data and blobs
```

## Sites, languages and publishing

- **Collections** ([ADR 2](docs/ADR/0002-collections-and-routes.md)): every object with a
  `slug` gets a list page and record pages; `scms.config.json` `collections` only
  overrides (`path`, `sort`, `perPage`, `home`, `list`, `publish`); `sort` also takes the
  `createdAt` and `updatedAt` every record carries. Templates resolve
  `<object>-<slug>.eta`, `<object>.eta`, `<object>-list.eta`, then `item.eta` / `list.eta`.
- **Private objects**: `"private": ["order"]` in `scms.config.json` names objects the
  site never reads, such as orders holding buyers' addresses. They are not fetched at
  build or in `serve`, so no template can print them; naming the assets object or an
  unknown object is an error.
- **Shared configs**: `scms.config.json` takes `"extends": "<path>"` like the app config
  (core ADR 15), and `theme` takes a path (`./themes/portfolio`) as well as a name,
  resolved against the file that declares it. Sites sharing one theme and setup
  each keep a one-line `scms.config.json`.
- **Languages** ([ADR 3](docs/ADR/0003-languages-in-urls.md)): taken from the app's
  `locales`; the default is unprefixed, the others live under `/<lang>/`.
- **Publishing**: list `{ "name": "sprintster-cms/publish" }` in the app's `plugins`
  for a Publish button and an unpublished-changes badge. `scms agent` keeps a WebSocket to
  each app, and on a request runs `scms build` and the site's deploy command.

## License

sprintster-cms is licensed under **AGPL-3.0-only WITH a runtime and output
exception**, the same terms as sprintster.

- **scms itself** is copyleft (AGPLv3): if you modify its source and distribute
  it, or offer a modified version over a network (including a hosted build or
  deploy service), you must release those modifications.
- **Your sites, content and themes**, and the **sites it builds**, are yours to
  license however you like. See [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION).

Full texts: [`LICENSE`](LICENSE) (AGPLv3) and
[`LICENSE-EXCEPTION`](LICENSE-EXCEPTION). SPDX:

```
AGPL-3.0-only WITH LicenseRef-sprintster-cms-runtime-exception
```

npm only accepts standard exceptions after `WITH`, so `package.json` declares
`AGPL-3.0-only` and the package ships `LICENSE-EXCEPTION` alongside it.
