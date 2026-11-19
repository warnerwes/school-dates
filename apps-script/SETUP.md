# School Dates Writer — Apps Script

The writer lives in a **dedicated standalone Apps Script project** (not the
attendance script), managed by clasp from `gas-project/`:

- **Source of truth:** [`gas-project/Code.js`](../gas-project/Code.js) (pushed with `clasp push`)
- **Editor:** https://script.google.com/d/1AZq1PpNCHZwqRo4s0M9qdxyiKHL95i_oQxzthQyejYoWYSEozqf5UHkW/edit

It runs `main()` daily, pulls PLSIS report 2618, and publishes `v1/*.json` to
this repo (served at https://dates.warner.click/v1/).

## Status

- [x] Script created + code deployed (`clasp push`)
- [x] Authorized (consent granted) and first `main()` run published real data
- [x] **Daily trigger** runs `main` between 3 and 4 a.m. Pacific.
- [x] Custom-domain HTTPS cert (auto-provisioning) → enable Enforce HTTPS
      (done 2026-09-07: issuance had stalled; removing and re-adding the custom domain
      in Settings → Pages restarted it, cert approved within a minute, Enforce HTTPS on)

## Secrets

Both live in **Project Settings → Script Properties** (never in source):

| Property | Value |
|---|---|
| `PLSIS_EXPORT_TOKEN` | The value of `_export_token` from the School Pathways export link for saved report 2618 |
| `GITHUB_PAT` | fine-grained PAT, Contents:write on `warnerwes/school-dates` (1-yr expiry — set a rotation reminder) |

## Functions

- `main()` — fetch → parse → derive → publish the four `v1/*.json`. Daily trigger target.
- `setup()` — dry-run: validates properties + fetch + GitHub auth, logs counts, publishes nothing.
- `inspect()` — diagnostic: logs the report's day-type codes and LP date ranges.

On failure `main()` writes `lastRunOk:false` to `health.json`, emails the owner,
and leaves the previous good files in place.

## Updating the code

Edit `gas-project/Code.js`, then `cd gas-project && clasp push`. The repo logic
mirror in `test/calendar-logic.js` is kept in sync and covered by
`node test/validate.js`. The single-commit GitHub publish sequence is covered by
`node test/github-publish.js`. Run `node --test test/report-export.js` to check report access and failure alerts.
