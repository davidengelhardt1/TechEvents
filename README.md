# Tech Event Globe

A 3D globe of tech conferences, summits and expos for the whole technology community, not just developers. See where events are and when they happen, then narrow them to what matters to you.

**Live site:** https://www.techeventsapp.us

**Status:** live. It reads approved events from a Supabase database and falls back to 27 built-in sample events if the database can't be reached.

## Features

- **3D globe** (globe.gl / three.js) with country fills and borders, plus a flat 2D map for devices without WebGL
- **Focus areas:** cybersecurity, offensive cyber, AI, machine learning, developer, architecture and cloud, open source, general tech
- **Time windows:** next 30 / 90 / 180 days, 1 year, or all dates
- **Clustering:** dense cities collapse into a count node and open into individual events on click or zoom
- **Search** by event, city, country, topic or year
- **Distance filter** from a chosen city or your location (a location from the browser is never put in a shared link)
- **Deadlines** for speaker submissions and early-bird pricing, only where an official page confirms them
- **Add to calendar:** Google Calendar link and an `.ics` download
- **Shareable views:** filters and the open event are stored in the URL hash

## URL parameters

| Parameter | Meaning | Example |
|---|---|---|
| `w` | time window in days, or `all` | `w=90` |
| `c` | focus areas, comma separated | `c=cyber,offsec` |
| `q` | search text | `q=kubecon` |
| `n`, `mi` | distance origin (a city from the data) and miles | `n=London&mi=250` |
| `e` | open event id | `e=defcon35` |
| `v` | `flat` for the 2D map | `v=flat` |

## Run locally

It is a single static file. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

The page loads globe.gl and fonts from CDNs, so it needs a network connection.

## Deploy on Vercel

Import the repo in Vercel. Framework preset: **Other**. No build command and no output directory needed. Every push to `main` redeploys. The site runs at https://www.techeventsapp.us.

## Backend (Supabase)

The page runs without a backend. To use a database:

1. Create a Supabase project (dedicated to this app).
2. Apply `supabase/migrations/20261026120000_create_events.sql` (SQL editor, or `supabase db push` with the CLI). It creates `events` and `event_deadlines` with PostGIS, row-level security, and an `events_near(lat, lng, miles)` function.
3. Run `supabase/seed.sql` to load the 27 sample events as approved.
4. Put the project URL and the **publishable (anon) key** in `config.js`. Never put a service-role key there.
5. Reload. If the table is empty or the request fails, the page falls back to the built-in sample.

Access rules: anyone can read events with `status = 'approved'`. Signed-in users can insert events as `pending`. Approving or rejecting is done with the service role (dashboard or the future ingestion job).

## Data

The built-in sample lives in the `RAW` array inside `index.html`:

`[id, name, start, end, city, country, lat, lng, metro, categories, url, kind, source, venue, note]`

- `kind` is `official` (organizer site) or `listing` (a third-party list)
- `metro` groups events for clustering, so use the same string for the same city area
- Deadlines are in the `DEADLINES` object, keyed by event id

The database uses the same fields (`categories` is `text[]`, `source` replaces the sample's source column). See the migration for the exact columns and checks.

Dates move. Confirm with the organizer before you book.

## Roadmap

1. ~~Supabase with PostGIS and row-level security~~ (schema and loader are in; project setup is a manual step above)
2. Submit-an-event form and an approval queue
3. Port to Next.js (App Router) with a server-rendered page per event
4. Ingestion job that normalizes event pages into the schema with an LLM and writes them as `pending`
5. Quality dashboard and an MCP server for querying events

## Credits

- [globe.gl](https://globe.gl) (MIT)
- Country shapes from [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain / ISC)
- Event data compiled from organizer sites and public listings
