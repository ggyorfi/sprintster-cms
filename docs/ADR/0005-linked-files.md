# 5. Linked files

Date: 2026-11-10

## Status

Accepted.

## Context

sprintster now stores PDFs as assets (core ADR 19). A body links to one as
`[label](/assets/<id>)`, pointing at the asset record like a body image. The
daemon serves the file only as a download, from the admin's origin, so the
site has to serve its own copy, and the link has to reach it.

## Decision

A markdown link whose URL is `<assets prefix>/<id>` resolves through the asset
record to `<assets prefix>/<id>/<file name>` (`files.ts`). The file name is the
uploaded one, folded to ASCII letters, digits, `.`, `_` and `-`, so the URL is
readable and the static host derives the content type from its extension.

`scms build` copies the file of every record a page links to, and only those.
`scms serve` answers the same path from the daemon. A link to a record that
does not exist fails the build, as a missing body image does. A link to an
image asset gets its original file, untouched.

## Consequences

- Replacing the file in the admin changes what the link downloads on the next
  build, and its URL changes only if the file name does.
- The asset id stays in the URL, so two records with the same file name never
  collide.
- Files are copied on every build. They are not cached like renditions, which
  is fine for documents of a few megabytes.
