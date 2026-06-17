# Apps Script writer — setup

`Code.gs` runs in the **robo-spark-attendance** Apps Script project on a daily
trigger. It pulls PLSIS report 2618 and publishes the JSON files in this repo's
`v1/` folder. Follow these steps once.

## 1. Create the GitHub PAT (the only write credential)

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** →
Generate new token:

- **Resource owner:** warnerwes
- **Repository access:** Only select repositories → `warnerwes/school-dates`
- **Permissions:** Repository permissions → **Contents: Read and write**
- **Expiration:** 1 year (set a calendar reminder to rotate)

Copy the token (starts `github_pat_...`).

## 2. Add the code

In the robo-spark-attendance Apps Script project: create a file `Code.gs` (or a
new file) and paste the contents of this repo's `apps-script/Code.gs`.

## 3. Set Script Properties (secrets)

Project Settings (gear) → **Script Properties** → Add:

| Property | Value |
|---|---|
| `PLSIS_PASSWORD` | the PLSIS account password |
| `GITHUB_PAT` | the `github_pat_...` token from step 1 |

## 4. Set the project timezone

Project Settings → Time zone → **America/Los_Angeles** (so trigger + derived
dates align with the school day).

## 5. Dry-run validation (no publish)

Run the `setup()` function once. Authorize the scopes when prompted (external
fetch + send email). Check **Executions / Logs** — you should see counts like:

```
{ "learningPeriods": N, "schoolDays": M, "holidays": K, "today": {...}, "nextVacation": {...} }
```

If it throws `missing required headers` or dates look wrong, the report's column
names or date format differ from expectations — capture the log and we'll adjust
`HEADERS` / `normalizeDate` in `Code.gs`.

## 6. Real publish + the trigger

- Run `main()` once manually to publish for real, then check
  https://dates.warner.click/v1/today.json updates.
- Triggers (clock icon) → Add trigger:
  - Function: `main`
  - Event source: Time-driven → Day timer → **3am to 4am** (Apps Script day-timers
    are hour-windowed; it fires once in that window — close enough to 3:15).
  - Failure notification: daily.

On any failure the job emails the effective user, writes `lastRunOk:false` to
`health.json`, and leaves the previous good files in place.
