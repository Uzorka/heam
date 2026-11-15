import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCSV, readXlsx, readStockList, TEMPLATE_HEADER } from '../../web/js/sheet.js';
import { xlsxParts } from '../../web/js/xlsx.js';

test('reads a real Excel file made by another program (compressed, shared text, dates, two sheets)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sheet-'));
  const file = join(dir, 'stock.xlsx');
  execFileSync('python3', ['-c', `
import openpyxl, datetime, sys
wb = openpyxl.Workbook()
ws = wb.active; ws.title = 'Stock'
ws.append(['Mama Put Stores - Yaba stock'])
ws.append([])
ws.append(['Product', 'SKU', 'Qty', 'Selling Price', 'Expiry Date'])
ws.append(['Peak Milk 400g', 'PM400', 24, 2500, datetime.date(2027, 3, 1)])
ws.append(['Indomie Chicken 70g & "Onion"', None, 120, '₦250', '31/12/2026'])
ws.append([None, None, None, None, None])
ws.append(['Golden Penny Sugar', None, 3.0, None, None])
wb.create_sheet('Notes').append(['ignore me'])
wb.save(sys.argv[1])`, file]);
  const rows = await readXlsx(readFileSync(file));
  const { items, problems, missing } = readStockList(rows);
  assert.deepEqual(missing, []);
  assert.deepEqual(problems, []);
  assert.deepEqual(items, [
    { name: 'Peak Milk 400g', code: 'PM400', qty: 24, price: 2500, expires_on: '2027-03-01' },
    { name: 'Indomie Chicken 70g & "Onion"', code: null, qty: 120, price: 250, expires_on: '2026-12-31' },
    { name: 'Golden Penny Sugar', code: null, qty: 3 },
  ]);
});

test('reads our own template back (so a downloaded template round-trips)', async () => {
  const bytes = Buffer.concat(xlsxParts('Stock', [TEMPLATE_HEADER, ['Peak Milk 400g', 'PM400', 24, 2500, 2300, '01/03/2027', 6]]).map((p) => Buffer.from(p)));
  const { items, problems } = readStockList(await readXlsx(bytes));
  assert.deepEqual(problems, []);
  assert.deepEqual(items, [{ name: 'Peak Milk 400g', code: 'PM400', qty: 24, price: 2500, lowest_price: 2300, expires_on: '2027-03-01', low_stock_at: 6 }]);
});

test('reads CSV: quotes, commas inside names, Windows line endings, semicolons', () => {
  assert.deepEqual(parseCSV('Name,Qty\r\n"Milo, 400g",5\r\n"He said ""hi""",2\r\n'), [['Name', 'Qty'], ['Milo, 400g', '5'], ['He said "hi"', '2']]);
  assert.deepEqual(parseCSV('﻿Name;Qty\nMilo;5'), [['Name', 'Qty'], ['Milo', '5']]);
});

test('explains every problem row in plain English, keeps the good rows', () => {
  const rows = parseCSV(`Item,Quantity,Price,Lowest price,Expiry,Reorder level
Milo,5,"1,500",1400,Mar 2027,2
Bread,-2,800,,,
Eggs,ten,100,,,
Rice,4,abc,,,
Beans,4,500,600,,
Oil,4,500,,next week,
,,,,,
Sugar,,200,,,
milo,3,,,,`);
  const { items, problems } = readStockList(rows);
  assert.deepEqual(items, [{ name: 'Milo', code: null, qty: 5, price: 1500, lowest_price: 1400, expires_on: '2027-03-31', low_stock_at: 2 }]);
  assert.deepEqual(problems, [
    'Row 3 (Bread): quantity "-2" should be a whole number, 0 or more',
    'Row 4 (Eggs): quantity "ten" should be a whole number, 0 or more',
    'Row 5 (Rice): selling price "abc" is not a number',
    'Row 6 (Beans): lowest price (₦600) is above the selling price (₦500)',
    'Row 7 (Oil): expiry date "next week" isn\'t a date. Use 31/03/2027',
    'Row 9 (Sugar): no quantity',
    'Row 10 (milo): also on row 2. Put each product on one row',
  ]);
});

test('says which columns are missing', () => {
  assert.deepEqual(readStockList(parseCSV('Product,Colour\nMilo,brown')).missing, ['Quantity']);
  assert.deepEqual(readStockList(parseCSV('a,b\n1,2')).missing, ['Product name', 'Quantity']);
});

test('dates: day first (Nigeria), impossible dates refused', () => {
  const r = readStockList(parseCSV('Name,Qty,Expiry\nA,1,05/04/2027\nB,1,31/02/2027\nC,1,2027-02-28\nD,1,1-Mar-27'));
  assert.deepEqual(r.items.map((x) => x.expires_on), ['2027-04-05', '2027-02-28', '2027-03-01']);
  assert.equal(r.problems.length, 1);
});
