# 4. Theme layers

Date: 2026-11-10

## Status

Accepted.

## Context

Sites running the same app share one theme (core ADR 15: `shared/<app>/`,
`"theme": "./themes/shop"`). scms reads a theme from one folder: templates,
includes and the `static/` files served at `/_theme`. Whatever differs per
site therefore lands in the shared theme too: one shop's palette, fonts,
favicon, variant photos and wording. With a second shop on the way, the
choices are a copy of the theme per site, where every fix is made once per
copy, or a way for a site to replace single files of a shared theme.

Other generators layer themes the second way. Hugo looks a file up in the
project first, then in each theme of a list, so a project overrides any
template or static file by placing one at the same path
([Hugo theme components](https://gohugo.io/hugo-modules/theme-components/)).
WordPress child themes name a parent theme and override its files one by one
([WordPress child themes](https://developer.wordpress.org/themes/advanced-topics/child-themes/)).

## Decision

**A theme may extend another: `theme.json` in the theme folder with
`"extends": "<parent>"`.** The parent is a path relative to the theme folder,
or a theme name resolved as `theme` in `scms.config.json` is. A parent may
extend in turn; a cycle is an error.

- **Lookup.** A template, an include and a static file are taken from the
  first layer that has the file at the same path, child first. An include
  inside a parent template still finds the child's version, so a site can
  replace one partial without copying the templates that use it.
- **Static files.** `scms build` copies each layer's `static/` into `_theme`,
  parent first, so the child's files win; `scms serve` serves `/_theme/*`
  from the layers in the same order.
- **Same word as the configs.** `extends` matches the config files (core
  ADR 15). A theme folder without `theme.json` behaves as before.
- **A site keeps only what differs.** A shared app's theme stays complete and
  neutral; each site's theme folder holds its overrides (brand stylesheet,
  fonts, favicon, images, a partial) and `theme.json`.

## Consequences

- A fix in a shared theme reaches every site that extends it.
- A child file shadows the parent's completely; a site that overrides a
  template takes on keeping it in step with the parent.
- The theme lookup touches the file system once per layer for a file the
  child lacks; templates are cached as before.
