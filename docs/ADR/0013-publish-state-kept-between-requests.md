# 13. Publish state kept between requests

Date: 2026-11-14

## Status

Accepted. Changes how ADR 7, 9 and 10 read what is published, not what they
decide.

## Context

Every status badge, record badge, State column, schedule and claim called
`published()`, which read every publication row and every publish job. On
tanarblog.hu that is about 9,300 rows a call, and the status badge was polled
every 10 seconds by each open admin tab; one tab used up the Cloudflare free
tier's daily reads for every app (core ADR 28).

## Decision

**`publishState(data)` derives once and then follows the log.** It reads the
publication rows, the jobs and the changes since the baseline once, with the
log position. A later call reads the position; when it moved, it reads only the
changes after it, re-reads the publication rows and jobs those name, and adds
the content changes. A new baseline (Publish all), a lower position, or an
erasure or redaction in the log makes it read everything again. Calls run one
at a time, and each caller gets its own copy of the maps.

**The snapshot outlives hibernation.** Where the host offers `ctx.data.keep`
(the Worker), the snapshot is stored there whenever its position moved and read
back after a wake, then brought up to date the same way.

**The status badge is pushed.** It no longer sets `refresh`; the admin reloads
it when the log moves (core ADR 28).

## Consequences

- An idle call reads one row (the position); a call after an edit reads the
  edit's events and the rows they name.
- Publish all costs one full read, as before.
- The equivalence of the kept and a fresh snapshot after every kind of change
  is tested (`plugin.test.ts`).
