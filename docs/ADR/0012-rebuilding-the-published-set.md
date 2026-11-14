# 12. Rebuilding the published set

Date: 2026-11-13

## Status

Accepted. Extends [ADR 10](./0010-published-snapshots-and-the-agent-copy.md).

## Context

The published set (ADR 10) lives in the store's pins, beside the log, not in
it. The publish plugin's own records, the marker saying the set was built
among them, are in the log. Moving an app by its log (`s8r export` and
`s8r import`) therefore carries the marker but not the set: the new store
believes its set is built, every record reads as published, Publish all pins
nothing, and the site builds empty. There was also no way to build the set
again when it is in doubt.

## Decision

**The set knows which store it is in.** Building it also pins the marker row
into a set of its own, `published-set-here`. A marker in the log without that
pin in the store is a set left behind, and the set is built again from the
publish records at the next read, as it is for a site published before ADR 10.
A site with nothing published yet has its pin and is left alone.

**`POST /plugins/publish/rebuild` builds the set again on request** and queues
a build. Every record is pinned again at the position its publish records
name, so the change feed carries all of them and the agent's copy is refreshed
in full. It changes nothing an editor decided.

It is rare and kept hard to reach:

- no button calls it;
- the body must name the app, `{ "confirm": "<app title>" }`, or it is a 400;
- hosts in front of the daemon should allow it to admins only (the tenants'
  gate refuses it to editors and the agent);
- it is logged with the actor who asked.

## Consequences

- An app moved by its log needs no extra step before its first publish.
- A site published before this change builds its set once more at its next
  read, with the same versions.
