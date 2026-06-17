# school-dates

Static **public API** for Pacific Coast school dates — learning periods, school days,
and holidays/vacations. Served free over GitHub Pages + CDN at:

> **https://dates.warner.click/v1/**

There is no server to spam and nothing to pay for: a single Google Apps Script job
runs at **3:15am America/Los_Angeles**, pulls PLSIS report 2618, computes the
calendar, and commits the JSON files in `v1/` to this repo. Every consuming app just
`fetch()`es a static file from the CDN. Reads never touch PLSIS.

## Endpoints

| URL | What |
|---|---|
| `v1/calendar.json` | Everything: learning periods, school days, holidays, derived fields |
| `v1/today.json` | Lightweight: is today a school day, current LP, day type |
| `v1/next-vacation.json` | Next vacation: name, start, end, days until |
| `v1/health.json` | Freshness: `lastUpdated`, `lastRunOk`, source |

All responses are JSON with `Access-Control-Allow-Origin: *` (CORS-open).

## Schema (`/v1` contract — frozen; breaking changes go to `/v2`)

```jsonc
// calendar.json
{
  "version": 1,
  "lastUpdated": "2026-06-17T10:15:00Z",   // ISO-8601 UTC, set each run
  "source": "PLSIS report 2618 (Pacific Coast)",
  "learningPeriods": [
    { "lp": "LP1", "start": "2025-09-02", "end": "2025-10-10" }   // dates: YYYY-MM-DD
  ],
  "schoolDays": [
    { "date": "2025-09-02", "type": "Schoolday" }                 // type: "Schoolday" | "HOL"
  ],
  "holidays": ["2025-11-27"],                                     // dates flagged non-school
  "today": {
    "date": "2026-06-17",
    "isSchoolDay": false,
    "currentLP": null,        // LP name if today falls inside one, else null
    "dayType": "Summer"       // "Schoolday" | "HOL" | "Summer" | "Weekend"
  },
  "nextVacation": { "name": "Summer Break", "start": "2026-06-12", "end": "2026-08-25", "daysUntil": 0 }
}
```

`today.json`, `next-vacation.json`, and `health.json` are slim projections of the
same data so a frequent poller fetches a few bytes instead of the whole year.

## How it's published

`apps-script/Code.gs` (source of truth for the writer) runs on a daily time trigger
in the **robo-spark-attendance** Apps Script project. Secrets — the PLSIS password
and a GitHub fine-grained PAT (contents:write on this repo only) — live in Script
Properties, never in source. On failure the job emails an alert and leaves the prior
files live (last-known-good).

## Consumers

- **robo-spark-attendance** — attendance app reads `today.json`.
- **warner.click** — (planned) reads `calendar.json` instead of pulling PLSIS directly.
- Future apps — just fetch the URLs above.
