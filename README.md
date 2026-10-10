# Done

A calm, day-by-day to-do list in the spirit of TeuxDeux. Installable PWA, works offline, syncs through Supabase, and tasks can be added remotely with one HTTP call or one SQL statement.

- **Days**: Today, Tomorrow, then the next days as columns (desktop) or swipeable pages with a day strip (mobile), plus a **Someday** list.
- **Quick add** at the top of every day (`Enter` to add, focus stays put so you can keep typing).
- **Move** a task by dragging (mouse, or long-press on touch), or with the `⋯` menu: Today / Tomorrow / pick a date / Someday. Edit inline, delete with undo, reorder.
- **Carried over**: unfinished tasks from past days roll forward into Today with a red "Carried over from…" marker.
- **Dopamine**: animated checkbox, strike-through sweep, confetti burst, haptic tick, soft pop (mute with `m`), daily streak, a progress ring for today and a bigger celebration when today is clear. Honors `prefers-reduced-motion`.
- **Install**: Add to Home Screen button (Chrome `beforeinstallprompt`, friendly Share → Add to Home Screen sheet on iOS). Hidden once installed.
- **Light/dark** follows the system.
- **Shortcuts**: `n` new, `t` today, `s` someday, `m` mute, `?` help, arrows to move, `Space`/`x` complete, `Enter`/`e` edit, `Alt+↑↓` reorder, `Alt+←→` change day, `Del` delete.

## Architecture

```
public/            static PWA (no build step): index.html, app.js, fx.js (confetti), sound.js, sw.js, manifest, icons
api/tasks.js       GET/POST/PATCH/DELETE  (passcode-protected, talks to Supabase with the service-role key)
api/ping.js        tells the client whether the server is configured / passcode is valid
supabase/schema.sql
scripts/dev.js     local dev server with an in-memory fake Supabase  (npm run dev, passcode "dev")
scripts/icons.py   regenerates the PNG icons
```

The browser never holds a database key. It stores a passcode in `localStorage` and sends it as the `x-passcode` header; the API compares it with `APP_PASSCODE`. The UI is optimistic and local-first: every change is applied instantly, cached in `localStorage` and pushed through an offline-safe write queue. The app polls every 15 s and on focus/online, so tasks added remotely appear on their own.

### Environment variables (Vercel)

| name | value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server only) |
| `APP_PASSCODE` | the passcode Rohan types once per device |
| `APP_TZ` | optional, default `America/New_York`: what "today" means for API calls that omit `date` |

Until `SUPABASE_*` are set the app still works fully on-device ("local only" status) and the API answers `503 storage_not_configured`.

### Database

Run `supabase/schema.sql` once (RLS enabled with no policies, so only the service role can touch it).

## Add a task remotely

### 1. HTTP API

```bash
curl -X POST https://<DEPLOYMENT_URL>/api/tasks \
  -H "x-passcode: <APP_PASSCODE>" -H "content-type: application/json" \
  -d '{"title":"Call the dentist","date":"tomorrow"}'
```

`date` may be omitted (= today in `APP_TZ`), `"today"`, `"tomorrow"`, `"YYYY-MM-DD"`, or `null` / `"someday"` for the Someday list. Optional: `source`. Other routes: `GET /api/tasks`, `PATCH /api/tasks?id=<uuid>` (title, date, done, position), `DELETE /api/tasks?id=<uuid>`. A wrong passcode returns `401`.

### 2. Straight into Supabase (no passcode needed, e.g. via the Supabase connector's `execute_sql`)

```sql
insert into public.tasks (title, date, source)
values ('Call the dentist', (now() at time zone 'America/New_York')::date, 'assistant');   -- today
-- tomorrow:  ((now() at time zone 'America/New_York')::date + 1)
-- specific:  '2026-10-15'
-- someday:   null
```

`position` defaults to "now", so new tasks land at the bottom of their day. The app picks it up within ~15 s (or immediately on focus).

## Develop

```bash
npm run dev      # http://localhost:3000, passcode "dev", in-memory fake database
```

Deploy: import the repo into Vercel (framework "Other", output directory `public`), add the env vars above.
