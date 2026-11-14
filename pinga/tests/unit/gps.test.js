import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, nearest, parseLatLng } from '../../web/js/gps.js';

const yaba = { name: 'Yaba', lat: 6.5095, lng: 3.3711 };
const ikeja = { name: 'Ikeja', lat: 6.6018, lng: 3.3515 };

test('distance between Yaba and Ikeja is about 10.5 km', () => {
  const d = distanceM(yaba, ikeja);
  assert.ok(d > 10300 && d < 10700, String(d));
  assert.equal(Math.round(distanceM(yaba, yaba)), 0);
});

test('nearest office is chosen', () => {
  const n = nearest([ikeja, yaba], { lat: 6.51, lng: 3.372 });
  assert.equal(n.place.name, 'Yaba');
  assert.ok(n.distance < 150);
  assert.equal(nearest([], { lat: 0, lng: 0 }), null);
});

test('locations pasted from Google Maps are understood', () => {
  assert.deepEqual(parseLatLng('6.5095, 3.3711'), { lat: 6.5095, lng: 3.3711 });
  assert.deepEqual(parseLatLng(' 6.5095 3.3711 '), { lat: 6.5095, lng: 3.3711 });
  assert.deepEqual(parseLatLng('-33.9,18.4'), { lat: -33.9, lng: 18.4 });
  for (const bad of ['', 'Yaba', '95, 3', '6.5', '6.5, 200']) assert.equal(parseLatLng(bad), null, bad);
});

test('phone and server measure distance the same way', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../supabase/migrations/20261115000001_attendance.sql', import.meta.url), 'utf8');
  assert.match(sql, /2 \* 6371000 \* asin/);
});
