// Runs the database rule tests (tests/db/test_*.sql) against the real staging database,
// inside a transaction that is always rolled back, so nothing is left behind.
//   NODE_USE_ENV_PROXY=1 node tests/staging/rules.js [staging|live]
// Safe on live too: every run is rolled back, so nothing is written.
import { readdirSync, readFileSync } from 'node:fs';
import { CONFIG_FOR } from '../../scripts/projects.js';

const target = process.argv[2] || 'staging';
const ref = CONFIG_FOR[target].ref;
const dir = new URL('../db/', import.meta.url);
const helpers = readFileSync(new URL('helpers.sql', dir), 'utf8');
// psql-only lines and the test's own begin/rollback are removed; we wrap it ourselves.
const clean = (s) => s.split('\n').filter((l) => !/^\\|^begin;$|^rollback;$/.test(l.trim())).join('\n');

let failed = false;
for (const file of readdirSync(dir).filter((f) => /^test_.*\.sql$/.test(f)).sort()) {
  const body = clean(readFileSync(new URL(file, dir), 'utf8'));
  const checks = (body.match(/tests\.(ok|eq|refused|no_rows)\(/g) || []).length;
  // Make the whole run fail at the end on purpose, so it is rolled back even if every check passes.
  const query = `begin;\n${helpers}\n${body}\nreset role;\ndo $$ begin raise exception 'ALL_PASSED'; end $$;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (text.includes('ALL_PASSED')) console.log(`ok - ${file}: all ${checks} checks passed on ${target}`);
  else { failed = true; console.log(`FAIL - ${file}: ${text.slice(0, 600)}`); }
}
process.exit(failed ? 1 : 0);
