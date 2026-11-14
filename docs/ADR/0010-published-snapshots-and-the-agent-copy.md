# 10. Published snapshots and the agent's copy

Date: 2026-11-13

## Status

Accepted. Changes how [ADR 7](./0007-publishing-per-record.md) and
[ADR 9](./0009-publication-states-and-scheduling.md) are stored and read; their
rules stand.

## Context

Builds read every published record by folding its events up to its published
position, in one unpaged response, on every build. With paged lists (core ADR
24) and pinned snapshots (core ADR 26) the published versions can be stored
once and read page by page, and the agent can stop asking for what it already
has.

## Decision

**The published version of a record is a snapshot in the `published` set.**
Publishing now, Publish all, and the maintenance switch pin the record at the
published position; a published delete unpins it. A schedule pins nothing until
it is due.

**Due schedules are applied when a build is claimed.** Claiming a job pins every
schedule whose date has passed, then the build reads. Between a schedule's date
and the next build, nothing on the site changes anyway.

**Builds read through the publish plugin, page by page.** `GET
/plugins/publish/records/<object>` takes the list query parameters (core ADR 24)
over the `published` set, each record carrying its `publishedAt` and
`lastPublishedAt`. `GET /plugins/publish/changes?after=<sequence>` pages through
the snapshots pinned or unpinned since a sequence, removed records included.

**The agent keeps a copy.** Per site it stores the published records and the
last sequence it has seen, on its own disk. A build first asks for the changes
since that sequence, applies them (removed records leave the copy), and builds
from the copy. With no copy, or a sequence the app no longer knows, it pages
through every published record. Erased records arrive as changes, so the copy
drops them too.

## Consequences

- A build costs the Durable Object a few small pages instead of every
  published record.
- The agent machine holds a copy of the published content; private objects are
  never fetched, so it holds nothing the public site does not show.
- Builds still render every page; rendering only what changed is a separate
  decision.
