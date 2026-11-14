# 11. Images written as HTML

Date: 2026-11-13

## Status

Accepted. Extends [ADR 5](./0005-linked-files.md) and
[ADR 8](./0008-linked-files-from-the-blob-store.md).

## Context

Bodies imported from older systems are HTML, and markdown-it passes HTML
through untouched, so an `<img src="/assets/<id>">` in them reached the site
with a URL nothing serves. Giving each such image renditions would add several
files per image to the build, thousands for an old blog, against a static
host's file limit.

## Decision

**An `<img>` in a body's HTML whose `src` is `/assets/<id>` shows that asset
record's file as it is**, at the record's linked file URL
(`<assets prefix>/<id>/<file name>`), copied or served from the blob store as
the site's `linkedFiles` says. No renditions are made for it. A missing record
fails the build, as a markdown image does. Any other `src` is left alone.

Images written as markdown keep their renditions.

## Consequences

- An imported image is served at its original size. Editing the body in the
  admin turns its images into markdown, and from then on they get renditions.
