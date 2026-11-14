import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { xlsxParts } from '../../web/js/xlsx.js';

test('makes a real .xlsx file that a spreadsheet program can open', () => {
  const rows = [
    ['Date', 'Name', 'Status', 'Late (min)'],
    ['2026-11-09', 'Sade Bello', 'Late', 40],
    ['2026-11-09', 'Ọlá & "Tunde" <Adé>', 'Present', null],
    ['2026-11-10', 'Remi Okafor', 'Absent', 0],
  ];
  const bytes = Buffer.concat(xlsxParts('Register Nov 2026', rows, [12, 24, 12, 10]).map((p) => Buffer.from(p)));
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'r.xlsx');
  writeFileSync(file, bytes);
  // Read it back with an independent library (openpyxl), as Excel would.
  const out = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
print(json.dumps({"name": ws.title, "rows": [list(r) for r in ws.iter_rows(values_only=True)],
  "bold": ws["A1"].font.b, "plain": bool(ws["A2"].font.b), "freeze": ws.freeze_panes, "width": ws.column_dimensions["B"].width}))
`, file]).toString());
  assert.equal(out.name, 'Register Nov 2026');
  assert.deepEqual(out.rows, [
    ['Date', 'Name', 'Status', 'Late (min)'],
    ['2026-11-09', 'Sade Bello', 'Late', 40],
    ['2026-11-09', 'Ọlá & "Tunde" <Adé>', 'Present', null],
    ['2026-11-10', 'Remi Okafor', 'Absent', 0],
  ]);
  assert.equal(out.bold, true, 'header is bold');
  assert.equal(out.plain, false, 'other rows are not');
  assert.equal(out.freeze, 'A2', 'header row stays visible when scrolling');
  assert.equal(out.width, 24);
});
