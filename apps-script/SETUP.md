# School Dates Writer — Apps Script

The writer lives in a **dedicated standalone Apps Script project** (not the
attendance script), managed by clasp from `gas-project/`:

- **Source of truth:** [`gas-project/Code.js`](../gas-project/Code.js) (pushed with `clasp push`)
- **Editor:** https://script.google.com/d/1AZq1PpNCHZwqRo4s0M9qdxyiKHL95i_oQxzthQyejYoWYSEozqf5UHkW/edit

It runs `main()` daily, pulls PLSIS report 2618, and publishes `v1/*.json` to
this repo (served at https://dates.warner.click/v1/).

## Status

- [x] Script created + code deployed (`clasp push`)
- [x] Script Properties set: `PLSIS_PASSWORD`, `GITHUB_PAT`
- [x] Authorized (consent granted) and first `main()` run published real data
- [ ] **Daily trigger** — Triggers (⏰) → Add Trigger → function `main`,
      Time-driven → Day timer → **3am–4am**, failure notification: daily
- [ ] Custom-domain HTTPS cert (auto-provisioning) → enable Enforce HTTPS

## Secrets

Both live in **Project Settings → Script Properties** (never in source):

| Property | Value |
|---|---|
| `PLSIS_PASSWORD` | PLSIS account password |
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
`node test/validate.js`.
