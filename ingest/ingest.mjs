// Event ingestion: reads the open confs.tech conference data, geocodes cities,
// skips anything we already have, and inserts the rest as PENDING events.
// Nothing goes live until you set status = 'approved' in Supabase.
//
// Usage:
//   node ingest/ingest.mjs --source-dir <conference-data/conferences> [--dry-run]
//        [--cache ingest/geocache.json] [--existing events.json] [--max-new 400] [--today YYYY-MM-DD]
// Env (not needed with --dry-run and --existing):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   (service role / secret key, server-side only)

import fs from 'node:fs';
import path from 'node:path';
import {
  categoriesFor, normCountry, mergeRaw, skipReason, findDuplicate, makeId,
  pickMetro, isRealDate,
} from './lib.mjs';

const UA = 'TechEventGlobe-ingest/1.0 (https://www.techeventsapp.us)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { 'max-new': '400' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'dry-run') o[k] = true;
    else o[k] = argv[++i];
  }
  return o;
}

function readSource(dir, today) {
  const year = Number(today.slice(0, 4));
  const out = [];
  for (const y of [year, year + 1]) {
    const yd = path.join(dir, String(y));
    if (!fs.existsSync(yd)) continue;
    for (const f of fs.readdirSync(yd)) {
      if (!f.endsWith('.json')) continue;
      const topic = f.slice(0, -5);
      let arr;
      try { arr = JSON.parse(fs.readFileSync(path.join(yd, f), 'utf8')); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const e of arr) if (e && typeof e === 'object') out.push({ ...e, _topic: topic });
    }
  }
  return out;
}

function authHeaders(key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`; // legacy JWT keys only
  return h;
}

async function loadExisting(args, env, fetchImpl) {
  if (args.existing) return JSON.parse(fs.readFileSync(args.existing, 'utf8'));
  const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = env;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --existing <file.json>.');
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetchImpl(`${url}/rest/v1/events?select=id,name,url,city,start_date,metro,lat,lng,status&order=id`, {
      headers: { ...authHeaders(key), Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`Reading existing events failed: HTTP ${r.status} ${await r.text()}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function geocode(city, country, cache, fetchImpl, state) {
  const key = `${city}|${country}`;
  if (key in cache) return cache[key];
  const wait = 1100 - (Date.now() - state.last);
  if (wait > 0 && !state.noWait) await sleep(wait);
  state.last = Date.now();
  const q = encodeURIComponent(`${city}, ${country}`);
  let r;
  try {
    r = await fetchImpl(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch { state.errors++; return undefined; }
  if (!r.ok) { state.errors++; return undefined; } // transient: do not cache
  const j = await r.json();
  const hit = j[0];
  const val = hit && Number.isFinite(+hit.lat) && Number.isFinite(+hit.lon)
    ? { lat: +(+hit.lat).toFixed(4), lng: +(+hit.lon).toFixed(4) } : null;
  cache[key] = val;
  return val;
}

export async function main(argv, env = process.env, fetchImpl = fetch) {
  const args = parseArgs(argv);
  if (!args['source-dir']) throw new Error('--source-dir is required');
  const today = args.today || new Date().toISOString().slice(0, 10);
  if (!isRealDate(today)) throw new Error('--today must be YYYY-MM-DD');
  const dry = !!args['dry-run'];
  const maxNew = Math.max(0, parseInt(args['max-new'], 10) || 0);
  const cachePath = args.cache || path.join(path.dirname(new URL(import.meta.url).pathname), 'geocache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* first run */ }

  const stats = { read: 0, merged: 0, skipped: {}, duplicates: 0, geocodeFailed: [], capped: 0, new: 0 };
  const bump = (k) => { stats.skipped[k] = (stats.skipped[k] || 0) + 1; };

  const raw = readSource(args['source-dir'], today);
  stats.read = raw.length;
  const merged = mergeRaw(raw);
  stats.merged = merged.length;

  const existing = await loadExisting(args, env, fetchImpl);
  const taken = new Set(existing.map((x) => x.id));
  const known = existing.map((x) => ({ metro: x.metro, lat: x.lat, lng: x.lng }));
  const gstate = { last: 0, errors: 0, noWait: !!env.TEG_NO_THROTTLE };

  const fresh = [];
  const deadlines = [];
  for (const e of merged.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const why = skipReason(e, today);
    if (why) { bump(why); continue; }
    const country = normCountry(e.country);
    const cand = {
      name: e.name.trim(), start_date: e.startDate, end_date: e.endDate || e.startDate,
      city: e.city.trim(), country, url: e.url.trim(),
    };
    const dup = findDuplicate({ ...cand, id: null }, existing.concat(fresh));
    if (dup) { stats.duplicates++; continue; }
    if (fresh.length >= maxNew) { stats.capped++; continue; }
    const pt = await geocode(cand.city, country, cache, fetchImpl, gstate);
    if (!pt) { stats.geocodeFailed.push(`${cand.city}, ${country}`); continue; }
    const id = makeId(cand, taken);
    if (!id) { bump('no id'); continue; }
    taken.add(id);
    const row = {
      id, ...cand, lat: pt.lat, lng: pt.lng,
      metro: pickMetro(cand.city, pt, known),
      categories: categoriesFor(e.topics, cand.name),
      kind: 'listing', source: 'confs.tech (MIT licensed)', venue: null, note: null, status: 'pending',
    };
    known.push({ metro: row.metro, lat: row.lat, lng: row.lng });
    fresh.push(row);
    if (e.cfpUrl && /^https?:\/\//i.test(e.cfpUrl) && isRealDate(e.cfpEndDate)) {
      deadlines.push({ event_id: id, type: 'cfp', deadline_date: e.cfpEndDate, deadline_time: null, url: e.cfpUrl });
    }
  }
  stats.new = fresh.length;

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));

  if (!dry) {
    const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = env;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY to write.');
    const post = async (table, rows, extra) => {
      for (let i = 0; i < rows.length; i += 100) {
        const r = await fetchImpl(`${url}/rest/v1/${table}${extra || ''}`, {
          method: 'POST',
          headers: { ...authHeaders(key), Prefer: 'return=minimal,resolution=ignore-duplicates' },
          body: JSON.stringify(rows.slice(i, i + 100)),
        });
        if (!r.ok) throw new Error(`Insert into ${table} failed: HTTP ${r.status} ${await r.text()}`);
      }
    };
    await post('events', fresh, '?on_conflict=id');
    await post('event_deadlines', deadlines);
  }

  const lines = [
    `## Event ingestion ${dry ? '(dry run, nothing written)' : ''}`,
    `- Entries read: ${stats.read}, after merging topics: ${stats.merged}`,
    `- Skipped: ${Object.entries(stats.skipped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `- Already in the database: ${stats.duplicates}`,
    `- ${dry ? 'Would add' : 'Added'} as pending: ${stats.new}${stats.capped ? ` (${stats.capped} more held back by the --max-new cap)` : ''}`,
    `- Deadlines ${dry ? 'would be added' : 'added'}: ${deadlines.length}`,
    `- Could not locate on the map: ${stats.geocodeFailed.length}${stats.geocodeFailed.length ? ' (' + [...new Set(stats.geocodeFailed)].slice(0, 15).join('; ') + ')' : ''}`,
    `- Geocoder errors this run: ${gstate.errors}`,
  ];
  const summary = lines.join('\n');
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ events: fresh, deadlines, stats }, null, 1));
  return { fresh, deadlines, stats };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
