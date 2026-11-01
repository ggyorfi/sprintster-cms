# 3. Languages in URLs

Date: 2026-11-01

## Status

Accepted. Settles the open point in
[ADR 2](0002-collections-and-routes.md).

## Context

The app config declares `locales`, default first, and translated fields store
one text per locale. A site needs every page once per language, with links that
stay in the reader's language. scms also had its own `langs` and `defaultLang`,
unused, which would have been a second list to keep in step.

## Decision

- **One list.** scms takes the languages from the app's `locales` over
  `/config`. `langs` and `defaultLang` leave `scms.config.json`; a config that
  still sets them is rejected with a message naming `locales`.
- **The default language has no prefix; every other one does.**
  `/works/mask/` is English, `/hu/works/mask/` Hungarian, `/hu/` the Hungarian
  home. A site with one language, or none declared, keeps exactly the URLs it
  has. The prefix comes after the preview base: `/preview/hu/works/mask/`.
- **The resolver owns it in both directions.** The language is read from the
  path first, then the path is matched within that language, and `urlFor`
  adds the same prefix. Every link a template gets (`url`, `paginator`,
  `site.home`) is in the page's language.
- **A collection path cannot start with a non-default language code**, checked
  with the other collection rules.
- **Fallback is per field.** A translated field missing in the page's language
  renders the default language's text; the page itself always exists.
- **Templates get `site.lang`, `site.locales` and `alternates`**, the same page
  in every language, for `<html lang>`, `hreflang` links and a language switch.

## Consequences

- A Hungarian page with no Hungarian text at all still renders, in English.
  Hiding untranslated records per language would be a publish rule, and is not
  needed yet.
- A root record slugged like a language code (`/hu/`) is shadowed by that
  language's home page.
- Slugs are not translated: `/hu/works/mask/` keeps the English slug.
