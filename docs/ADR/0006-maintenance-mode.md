# 6. Maintenance mode

Date: 2026-11-10

## Status

Accepted.

## Context

An owner sometimes needs the public site out of sight for a while (a
rebrand, content not ready, a legal hold) without losing it. Our sites are
static files: on Cloudflare a Worker with assets only and no script, elsewhere
any static host. The correct answer for "temporarily down" is 503 with
`Retry-After`, but only code can give it: on Cloudflare a script in front of
the files, counted as a Worker request on every visit while it is on.

## Decision

A switch in the content, not in the hosting. `scms.config.json` names a boolean
on a singleton, `"maintenance": "settings.maintenance"`. While it is true,
`scms build` writes only the theme's `maintenance.eta`, rendered without
`layout.eta` so it links nowhere, as both `index.html` and `404.html`, plus the
theme's static files. Every URL then shows that page, on any host that serves a
`404.html` for missing paths.

The switch sits on the admin's Maintenance page: the publish plugin, given
the same pointer in its config (`"maintenance": "settings.maintenance"`),
shows a "Site online / offline" badge and a button there (core's GUI
placement, `placement: 'maintenance'`). Pressing it flips the boolean and
queues a Publish, since nothing changes on the site until a build. The
message stays in the singleton, edited with the rest of the settings.

The rendition cache lives outside the output (`.scms/cache`), so switching back
on is a normal, fast build.

Every build checks the setup, switched on or not: the theme's
`maintenance.eta` must exist, and the named property must be a boolean on a
singleton. An app that does not have the property yet only gets a warning and
builds normally, so a site whose admin is deployed after the agent's new scms
keeps publishing.

## Consequences

- No Worker code and no extra requests: the site stays static throughout.
- Pages answer 404, not 503. Search engines may start dropping pages if it
  stays on for weeks; for a short break that is acceptable.
- `scms serve` and `scms dev` follow the switch the same way (200 at `/`, 404
  elsewhere), except under `/preview`, which keeps showing the real site so the
  owner can keep working on it.
- The page is rendered in the default language only.
