// Run with: node --test ingest/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categoriesFor, normCountry, slugify, urlKey, skipReason, findDuplicate, makeId, pickMetro, mergeRaw } from './lib.mjs';
import { main } from './ingest.mjs';

test('categories map topics and names', () => {
  assert.deepEqual(categoriesFor(['security'], 'BSides Foo'), ['cyber']);
  assert.deepEqual(categoriesFor(['data'], 'Data + AI Summit'), ['ai', 'ml']);
  assert.deepEqual(categoriesFor(['general'], 'Web Summit'), ['general']);
  assert.deepEqual(categoriesFor(['general', 'javascript'], 'JSConf'), ['dev']);
  assert.deepEqual(categoriesFor(['security'], 'Offensive Security Con'), ['cyber', 'offsec']);
  assert.deepEqual(categoriesFor(['unknown-topic'], 'Thing'), ['general']);
});

test('country and slug helpers', () => {
  assert.equal(normCountry('U.S.A.'), 'USA');
  assert.equal(normCountry('U.K.'), 'UK');
  assert.equal(normCountry('Germany'), 'Germany');
  assert.equal(slugify('Zürich Dev & Ops!'), 'zurich-dev-and-ops');
  assert.equal(urlKey('https://www.Example.com/a/'), 'example.com/a');
});

test('skip reasons', () => {
  const ok = { name: 'Good Conf', url: 'https://x.org', startDate: '2026-11-01', endDate: '2026-11-02', city: 'Paris', country: 'France' };
  assert.equal(skipReason(ok, '2026-10-26'), null);
  assert.equal(skipReason({ ...ok, online: true }, '2026-10-26'), 'online');
  assert.equal(skipReason({ ...ok, city: undefined }, '2026-10-26'), 'no city');
  assert.equal(skipReason({ ...ok, url: 'javascript:alert(1)' }, '2026-10-26'), 'bad url');
  assert.equal(skipReason({ ...ok, startDate: '2026-02-30' }, '2026-10-26'), 'bad date');
  assert.equal(skipReason({ ...ok, endDate: '2026-10-01' }, '2026-10-26'), 'end before start');
  assert.equal(skipReason({ ...ok, endDate: '2026-12-30' }, '2026-10-26'), 'too long');
  assert.equal(skipReason({ ...ok, startDate: '2026-01-01', endDate: '2026-01-02' }, '2026-10-26'), 'past');
});

test('duplicate detection', () => {
  const ex = [{ id: 'qcon26', name: 'QCon San Francisco 2026', url: 'https://qconsf.com', city: 'San Francisco, CA', start_date: '2026-11-16' }];
  const c = (o) => ({ id: 'new', name: 'QCon San Francisco 2026', url: 'https://qconsf.com/', city: 'San Francisco, CA', start_date: '2026-11-16', ...o });
  assert.ok(findDuplicate(c({}), ex));
  assert.ok(findDuplicate(c({ name: 'QCon SF', start_date: '2026-11-17' }), ex), 'same url+city, near date');
  assert.ok(!findDuplicate(c({ name: 'QCon SF', url: 'https://other.org', start_date: '2026-11-17' }), ex));
  assert.ok(!findDuplicate(c({ start_date: '2027-11-16' }), ex), 'next year is a new event');
  assert.ok(findDuplicate(c({ name: 'QCon San Francisco', url: 'https://x.org', start_date: '2026-11-18' }), ex), 'year in name is ignored');
});

test('ids are valid and unique', () => {
  const taken = new Set();
  const a = { name: 'My Conf', city: 'Paris', start_date: '2026-11-01' };
  const id1 = makeId(a, taken); taken.add(id1);
  const id2 = makeId(a, taken);
  assert.match(id1, /^[a-z0-9][a-z0-9-]{1,63}$/);
  assert.notEqual(id1, id2);
  assert.match(makeId({ name: 'x'.repeat(200), city: 'Paris', start_date: '2026-11-01' }, new Set()), /^[a-z0-9][a-z0-9-]{1,63}$/);
});

test('metro joins nearby events', () => {
  const known = [{ metro: 'San Francisco Bay Area', lat: 37.7749, lng: -122.4194 }];
  assert.equal(pickMetro('Oakland, CA', { lat: 37.8044, lng: -122.2712 }, known), 'San Francisco Bay Area');
  assert.equal(pickMetro('Sacramento, CA', { lat: 38.5816, lng: -121.4944 }, known), 'Sacramento, CA');
});

test('merges the same event listed under two topics', () => {
  const m = mergeRaw([
    { name: 'A', url: 'https://a.org', startDate: '2026-11-01', city: 'Paris', _topic: 'data' },
    { name: 'A', url: 'https://a.org/', startDate: '2026-11-01', city: 'Paris', cfpUrl: 'https://a.org/cfp', cfpEndDate: '2026-12-01', _topic: 'general' },
  ]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].topics.sort(), ['data', 'general']);
  assert.equal(m[0].cfpUrl, 'https://a.org/cfp');
});

test('end to end with stubbed network', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ing-'));
  fs.mkdirSync(path.join(dir, 'src', '2026'), { recursive: true });
  const w = (f, a) => fs.writeFileSync(path.join(dir, 'src', '2026', f), JSON.stringify(a));
  w('security.json', [
    { name: 'NewSec', url: 'https://newsec.org', startDate: '2026-11-20', endDate: '2026-11-21', city: 'Oakland, CA', country: 'U.S.A.', cfpUrl: 'https://newsec.org/cfp', cfpEndDate: '2026-11-01' },
    { name: 'Online Only', url: 'https://on.org', startDate: '2026-11-20', endDate: '2026-11-21', online: true },
    { name: 'QCon San Francisco 2026', url: 'https://qconsf.com', startDate: '2026-11-16', endDate: '2026-11-18', city: 'San Francisco, CA', country: 'U.S.A.' },
    { name: 'Nowhere Con', url: 'https://nowhere.org', startDate: '2026-12-01', endDate: '2026-12-02', city: 'Atlantis', country: 'Sea' },
  ]);
  const existing = [{ id: 'qcon26', name: 'QCon San Francisco 2026', url: 'https://qconsf.com', city: 'San Francisco, CA', start_date: '2026-11-16', metro: 'San Francisco Bay Area', lat: 37.79, lng: -122.4, status: 'approved' }];
  fs.writeFileSync(path.join(dir, 'existing.json'), JSON.stringify(existing));
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('nominatim')) {
      const q = decodeURIComponent(url.split('q=')[1]);
      const body = q.startsWith('Oakland') ? [{ lat: '37.8044', lon: '-122.2712' }] : [];
      return { ok: true, status: 200, json: async () => body };
    }
    posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 201, text: async () => '' };
  };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_abc', TEG_NO_THROTTLE: '1' };
  const args = ['--source-dir', path.join(dir, 'src'), '--existing', path.join(dir, 'existing.json'), '--cache', path.join(dir, 'cache.json'), '--today', '2026-10-26'];

  const dry = await main([...args, '--dry-run'], env, fetchImpl);
  assert.equal(posts.length, 0, 'dry run writes nothing');
  assert.equal(dry.fresh.length, 1);

  const real = await main(args, env, fetchImpl);
  assert.equal(real.fresh.length, 1);
  const ev = posts.find((p) => p.url.includes('/events')).body[0];
  assert.equal(ev.name, 'NewSec');
  assert.equal(ev.status, 'pending');
  assert.equal(ev.country, 'USA');
  assert.equal(ev.metro, 'San Francisco Bay Area');
  assert.deepEqual(ev.categories, ['cyber']);
  assert.equal(ev.kind, 'listing');
  const dl = posts.find((p) => p.url.includes('event_deadlines')).body[0];
  assert.equal(dl.event_id, ev.id);
  assert.equal(dl.deadline_date, '2026-11-01');
  assert.equal(posts[0].headers.Authorization, undefined, 'new-style secret keys are not sent as a bearer token');
  assert.equal(real.stats.geocodeFailed.length, 1);
  assert.equal(real.stats.duplicates, 1);
});
