# 9. Publication states and scheduling

Date: 2026-11-12

## Status

Accepted. Replaces parts of [ADR 7](./0007-publishing-per-record.md): the
record badge, scheduling from content dates, and, for apps with the publish
plugin, the `status` and `publishedAt` convention of
[ADR 2](./0002-collections-and-routes.md). ADR 7's published positions, Publish
all and reading published versions stand.

## Context

With per-record publishing (ADR 7) an article still carried `status` and
`publishedAt` as form fields. Editors could set an article to "published"
without publishing it, publish a draft that then stayed hidden, or move a date
by hand. Those fields are workflow state, not content: they describe what
happened to the record, and the publish plugin already knows that.

## Decision

**A record is in one of three states, worked out by the plugin, never stored:**

| state | colour | when |
| --- | --- | --- |
| published | green | no change after its published position, no schedule |
| scheduled | yellow | a schedule is set and nothing changed since it was made |
| pending | red | changed after its published position, or never published, with no schedule |

**The plugin keeps the dates** on the record's `publication` row:

- `publishedAt`: the first time the record went live. Set once, never moved by
  a later publish. The site shows it and sorts by it.
- `lastPublishedAt`: the latest time a version went live. The admin list shows
  it; the site gets it for `dateModified` in page metadata, not for display.
- `scheduledAt` with `scheduledPosition`: a version waiting for its date.

A record published before this decision takes as its first date its own
`publishedAt` value when it has one (older data, an import), else its
`createdAt`. An author who wants readers to know about an update says so in
the text, as editors do today.

**Publishing.** Each row of a list, and the record's dialog, has a Publish
button, disabled when the record is published. It opens a dialog: publish now,
or pick a date in the future.

- **Now:** the published position becomes the current position,
  `lastPublishedAt` now, `publishedAt` now unless already set; any schedule is
  dropped; a build is queued.
- **On a date:** `scheduledAt` is the date and `scheduledPosition` the current
  position. Until the date the site keeps showing the previous published
  version, or nothing for a new record.
- **Any edit drops the schedule.** A change after `scheduledPosition` makes the
  schedule void and the record pending again: editing a scheduled record is an
  anomaly that needs the editor to publish again.

**When the date arrives** the schedule takes effect when the plugin next works
out the record's state: the published position becomes `scheduledPosition`,
and the dates are set as for publishing now, with the scheduled date as the
time. The agent asks the plugin for the next `scheduledAt` (replacing ADR 7's
reading of content dates), sets one timer, and requests a build when it fires;
a date missed while it was offline is built when it reconnects.

**Forms lose the workflow fields.** With the publish plugin, objects need no
`status` or `publishedAt` property: the build route adds `publishedAt` and
`lastPublishedAt` to every record it returns, and a collection's `sort:
"-publishedAt"` sorts by the plugin's value. Publish all also counts as
publishing now for every pending record. Apps without the plugin keep ADR 2's
convention unchanged.

## Consequences

- An editor sees the state of every record in the list, by colour, and has one
  way to make a version live.
- Reordering by republishing cannot happen: the order follows the first
  publish date.
- The list column and the dialog need core support (core ADR 25).
- Existing apps with the plugin migrate once: their `status` and `publishedAt`
  fields are dropped from views, and their values become the first publish
  dates by the rule above.
