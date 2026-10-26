// Pure helpers for the event ingestion job. No network, no file access.

// confs.tech topic -> our category ids (cyber, offsec, ai, ml, dev, arch, oss, general)
export const TOPIC_CATS = {
  security: ['cyber'],
  data: ['ml'],
  general: ['general'],
  opensource: ['oss'],
  devops: ['arch'],
  sre: ['arch'],
  networking: ['arch'],
  iot: ['arch'],
  performance: ['arch', 'dev'],
  api: ['dev'],
  graphql: ['dev'],
  testing: ['dev'],
  accessibility: ['dev'],
  css: ['dev'],
  javascript: ['dev'],
  typescript: ['dev'],
  java: ['dev'],
  kotlin: ['dev'],
  groovy: ['dev'],
  python: ['dev'],
  php: ['dev'],
  dotnet: ['dev'],
  android: ['dev'],
  ios: ['dev'],
  rust: ['dev'],
  golang: ['dev'],
  cpp: ['dev'],
  clojure: ['dev'],
  haskell: ['dev'],
  ux: ['general'],
  product: ['general'],
  leadership: ['general'],
  'tech-comm': ['general'],
};

const CAT_ORDER = ['cyber', 'offsec', 'ai', 'ml', 'dev', 'arch', 'oss', 'general'];

export function categoriesFor(topics, name) {
  const set = new Set();
  for (const t of topics) for (const c of TOPIC_CATS[t] || []) set.add(c);
  const n = String(name || '');
  if (/\b(AI|GenAI|LLMs?|agentic)\b|artificial intelligence/i.test(n)) set.add('ai');
  if (/machine learning|\bML\b|MLOps/i.test(n)) set.add('ml');
  if (/hack|offensive|red team|pentest|exploit|defcon|def con/i.test(n)) set.add('offsec');
  if (/security|cyber|infosec|hack/i.test(n)) set.add('cyber');
  // A broad "general" tag adds nothing once a specific topic is known.
  if (set.size > 1) set.delete('general');
  if (set.size === 0) set.add('general');
  return CAT_ORDER.filter((c) => set.has(c));
}

const COUNTRY_FIX = { 'U.S.A.': 'USA', 'U.S.': 'USA', 'United States': 'USA', 'U.K.': 'UK', 'United Kingdom': 'UK' };
export function normCountry(c) {
  const s = String(c || '').trim();
  return COUNTRY_FIX[s] || s;
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Years are dropped so "QCon SF 2026" and "QCon SF" count as the same event.
export const nameKey = (s) => String(s || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, '').replace(/[^a-z0-9]+/g, '');
export const cityKey = (s) => nameKey(String(s || '').split(',')[0]);

export function urlKey(u) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return '';
  }
}

export function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Same metro string as the nearest known event within 60 km, else the city itself.
export function pickMetro(city, point, known) {
  let best = null, bestKm = 60;
  for (const k of known) {
    if (!k.metro || typeof k.lat !== 'number' || typeof k.lng !== 'number') continue;
    const km = haversineKm(point, k);
    if (km <= bestKm) { best = k.metro; bestKm = km; }
  }
  return best || city;
}

// Merge confs.tech entries that are the same event listed under several topics.
// entries: [{...raw, _topic}]
export function mergeRaw(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const k = (urlKey(e.url) || nameKey(e.name)) + '|' + e.startDate + '|' + cityKey(e.city);
    const cur = byKey.get(k);
    if (cur) { cur.topics.add(e._topic); if (!cur.cfpUrl && e.cfpUrl) { cur.cfpUrl = e.cfpUrl; cur.cfpEndDate = e.cfpEndDate; } }
    else byKey.set(k, { ...e, topics: new Set([e._topic]) });
  }
  return [...byKey.values()].map((e) => ({ ...e, topics: [...e.topics] }));
}

// Returns a reason string if the entry should be skipped, else null.
export function skipReason(e, today) {
  if (e.online) return 'online';
  if (!e.city || !e.country) return 'no city';
  const name = String(e.name || '').trim();
  if (name.length < 3 || name.length > 200) return 'bad name';
  if (!/^https?:\/\//i.test(String(e.url || ''))) return 'bad url';
  if (!isRealDate(e.startDate) || !isRealDate(e.endDate || e.startDate)) return 'bad date';
  const end = e.endDate || e.startDate;
  if (end < e.startDate) return 'end before start';
  if (dayDiff(end, e.startDate) > 21) return 'too long';
  if (end < today) return 'past';
  return null;
}

// Does an existing row (any status) already cover this candidate?
export function findDuplicate(c, existing) {
  const nk = nameKey(c.name), uk = urlKey(c.url), ck = cityKey(c.city);
  for (const x of existing) {
    if (x.id === c.id) return x;
    const near = Math.abs(dayDiff(x.start_date, c.start_date)) <= 30;
    if (!near) continue;
    if (nameKey(x.name) === nk) return x;
    if (uk && urlKey(x.url) === uk && cityKey(x.city) === ck) return x;
  }
  return null;
}

export function makeId(c, taken) {
  const year = c.start_date.slice(0, 4);
  const tries = [
    `${slugify(c.name)}-${year}`,
    `${slugify(c.name)}-${slugify(c.city.split(',')[0])}-${year}`,
    `${slugify(c.name)}-${slugify(c.city.split(',')[0])}-${c.start_date}`,
  ];
  for (let t of tries) {
    t = t.slice(0, 64).replace(/-+$/, '');
    if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(t) && !taken.has(t)) return t;
  }
  return null;
}
