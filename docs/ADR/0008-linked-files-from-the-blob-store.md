# 8. Linked files from the blob store

Date: 2026-11-12

## Status

Accepted. Replaces the copy step of [ADR 5](./0005-linked-files.md); its URLs
stand.

## Context

ADR 5 copies every linked file into the build output. A download library of
hundreds of files, some over 40 MB, runs into a static host's limits: 25 MiB
per file and 20,000 files per deploy on Cloudflare's free plan. The files are
already in the app's blob store.

## Decision

**A site opts in with `"linkedFiles": "blob-store"`** in `scms.config.json`;
the default, `"copy"`, keeps ADR 5's copies, so a site whose host has no access
to the blob store keeps working.

**With it, `scms build` writes a manifest instead of copying:** `_files.json` at
the output root maps each linked file's path
(`<assets prefix>/<id>/<file name>`) to its blob hash and file name.

**The site's host serves those paths from the blob store** with core's
`blobResponse` (core ADR 23), after no static file matched:

- on Cloudflare, the site's Worker reads the manifest from its static assets
  and the blob from a binding to the app's R2 bucket, with core's
  `createR2BlobStore` so the key scheme stays core's;
- `scms serve` answers the same paths from the daemon, as before.

Only paths in the manifest are served, so a file that no published page
links to stays private even when its hash is known.

## Consequences

- File size and count no longer count against the static host.
- The site Worker needs a binding to the admin's R2 bucket. Another static
  host needs an equivalent small server in front of the same store.
- Renditions and image originals are still copied: they are small and
  generated.
