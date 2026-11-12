# 7. Publishing per record

Date: 2026-11-12

## Status

Accepted. Replaces the agent reading the log position when it claims a job.

## Context

Publish built the site from every record's current state. With more than one
editor that publishes work in progress: editor A saves a draft edit to a live
article, editor B presses Publish for their own article, and A's unfinished
edit goes out with it. A future-dated record had a second problem: nothing
built the site when its date arrived.

## Decision

**A record is published at a log position.** The site shows each record as it
was at its published position (core ADR 21), never its current state. Edits
after that position are pending until the record is published again.

- **Publish (on a record)** is a record action (core ADR 22). It sets the
  record's published position to the current log position, does the same for
  the never-published records it points at, transitively (its `ref` and `refs`
  values, and the asset records its text links to), names those in its reply,
  and queues a build. A record it points at that is already published keeps
  its position, pending edits and all. A record badge shows Published, Changes
  not published or Not published.
- **Publish all** sets every record's published position to the current
  position and queues a build. Its confirmation says that it publishes every
  editor's pending changes.
- A delete is a change like any other: the record stays on the site until the
  delete is published.

**Storage.** The plugin keeps a `publication` record per record published on
its own (object, record id, position) and one baseline: the position of the
last Publish all. A record's published position is the later of the two. A
site published before this decision gets as its baseline the position of its
last successful build, so upgrading changes nothing on the site.

**Builds** read `GET /plugins/publish/records/<object>`, which returns the
published version of every record. Preview and `scms serve` keep showing the
current state.

**Scheduled builds.** After every build, and whenever it connects, the agent
reads the published records, finds the earliest publish date later than now
(each collection's `publish.date`, `publishedAt` by default), and sets one
timer for it. When it fires the agent requests a publish like the button does,
so the build shows everything due by then and the history lists it, and then
looks again. A date missed while the agent was offline is built as soon as it
reconnects. Nothing is stored on the agent.

**Telling pending from never published.** The plugin reads the log's changes
since the baseline. A record whose first change there is its `Added` event
was created after the baseline, so it is not published until its own position
reaches that event.

## Consequences

- Pressing Publish on one record never ships another editor's pending edits.
  Publish all still can, and says so.
- A record changed by two editors is published as a whole: the per-record
  position cannot skip one editor's events in between.
- The badge's count is the number of records whose latest change is after
  their published position.
