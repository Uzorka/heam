import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { normalizePhone, loginEmailFor, displayPhone, validPin, PHONE_LOGIN_DOMAIN } from '../../web/js/phone.js';
import { validPin as serverValidPin } from '../../supabase/functions/accept-invite/handler.js';

test('phone numbers people type are understood', () => {
  for (const typed of ['08031234567', '0803 123 4567', '0803-123-4567', '+234 803 123 4567', '2348031234567', '8031234567', '002348031234567']) {
    assert.equal(normalizePhone(typed), '+2348031234567', typed);
  }
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
});

test('nonsense phone numbers are rejected', () => {
  for (const bad of ['', '123', '0803123456', 'abc', '+0803', '080312345678', null, undefined]) {
    assert.equal(normalizePhone(bad), null, String(bad));
  }
});

test('phone numbers display the Nigerian way', () => {
  assert.equal(displayPhone('+2348031234567'), '0803 123 4567');
  assert.equal(displayPhone('+447700900123'), '+447700900123');
});

test('phone login address matches the database', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  assert.ok(sql.includes(`'@${PHONE_LOGIN_DOMAIN}'`), 'domain in SQL must match phone.js');
  assert.equal(loginEmailFor('+2348031234567'), `2348031234567@${PHONE_LOGIN_DOMAIN}`);
});

test('PIN rules: 6 digits, not easy to guess, same on phone and server', () => {
  const samples = ['482913', '123456', '111111', '000000', '654321', '12345', '1234567', 'abcdef', '48291a', '', null, '907153'];
  for (const s of samples) assert.equal(validPin(s), serverValidPin(s), String(s));
  assert.equal(validPin('482913'), true);
  assert.equal(validPin('111111'), false);
  assert.equal(validPin('123456'), false);
  assert.equal(validPin('12345'), false);
});

test('deploy targets match the app settings (staging is staging, live is live)', async () => {
  const { CONFIG_FOR } = await import('../../scripts/projects.js');
  const cfg = readFileSync(new URL('../../web/js/config.js', import.meta.url), 'utf8');
  for (const env of ['staging', 'live']) {
    const line = cfg.split('\n').find((l) => l.trim().startsWith(env + ':'));
    assert.ok(line.includes(`https://${CONFIG_FOR[env].ref}.supabase.co`), env + ' url');
    assert.ok(line.includes(CONFIG_FOR[env].key), env + ' key');
  }
});
