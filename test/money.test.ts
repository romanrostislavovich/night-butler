import assert from 'node:assert/strict';
import { test } from 'node:test';
import { merchantKey, parseStatement, type Transaction } from '../src/jobs/bank.ts';
import { doubleCharges, subscriptions, unusual } from '../src/jobs/money.ts';

const tx = (date: string, description: string, amount: number): Transaction => ({
  date,
  description,
  amount,
  key: merchantKey(description),
});

test('a shop is one key under every description it comes with', () => {
  assert.equal(merchantKey('SQ *BLUE BOTTLE COFFEE 4421 SAN FRANCISCO CA'), 'BLUE BOTTLE COFFEE');
  assert.equal(merchantKey('NETFLIX.COM'), 'NETFLIX');
  assert.equal(merchantKey('SPOTIFY USA 8823'), 'SPOTIFY USA');
  assert.equal(merchantKey('PAYPAL *JSMITHDESIGN'), 'JSMITHDESIGN');
  assert.equal(merchantKey('ŻABKA Z5521 WARSZAWA'), 'ŻABKA WARSZAWA');
  assert.equal(merchantKey('PLANET FITNESS #1123'), 'PLANET FITNESS');
  assert.equal(merchantKey('AMZN Mktp US*2K4L97'), merchantKey('AMZN Mktp US*9ZZ1'));
  assert.equal(merchantKey('TRADER JOE S #552'), merchantKey('TRADER JOE S #31'));
});

test('a statement is read by its column names, quotes and all', () => {
  const rows = parseStatement(
    '﻿Date;Details;Amount\n2026-10-01;"ACME; PAYROLL";4200,00\n2026-10-02;Coffee;-4.5\n',
  );
  assert.deepEqual(
    rows.map(({ date, description, amount }) => [date, description, amount]),
    [
      ['2026-10-01', 'ACME; PAYROLL', 4200],
      ['2026-10-02', 'Coffee', -4.5],
    ],
  );
  assert.deepEqual(parseStatement('When,What\n2026-10-01,x'), []);
});

test('a Polish export: lines before the table, "#" names, dates and amounts as banks write them', () => {
  const mbank = [
    'mBank S.A. Bankowość Detaliczna;',
    'Lista operacji;',
    '',
    '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;',
    '2026-10-18;"ŻABKA Z5521 WARSZAWA";eKonto;Żywność;-12,49 PLN;',
    '18.10.2026;"PRZELEW WYNAGRODZENIE";eKonto;Wpływy;"8 450,00 PLN";',
  ].join('\n');
  assert.deepEqual(
    parseStatement(mbank).map(({ date, description, amount }) => [date, description, amount]),
    [
      ['2026-10-18', 'ŻABKA Z5521 WARSZAWA', -12.49],
      ['2026-10-18', 'PRZELEW WYNAGRODZENIE', 8450],
    ],
  );
});

test('a charge about the same every month is a subscription; a rise is told', () => {
  const found = subscriptions([
    tx('2026-07-05', 'NETFLIX.COM', -15.49),
    tx('2026-08-05', 'NETFLIX.COM', -15.49),
    tx('2026-09-05', 'NETFLIX.COM', -15.49),
    tx('2026-10-05', 'NETFLIX.COM', -17.99),
    // Groceries every month, never the same: not a subscription.
    tx('2026-07-03', 'SAFEWAY 1', -30),
    tx('2026-08-03', 'SAFEWAY 1', -90),
    tx('2026-09-03', 'SAFEWAY 1', -55),
  ]);
  assert.deepEqual(
    found.map(({ key, amount, roseFrom }) => [key, amount, roseFrom]),
    [['NETFLIX', 17.99, 15.49]],
  );
});

test('the same amount from the same shop within days is charged twice', () => {
  const found = doubleCharges([
    tx('2026-09-12', 'ADOBE *CREATIVE CLD', -59.99),
    tx('2026-09-14', 'ADOBE *CREATIVE CLD', -59.99),
    tx('2026-10-12', 'ADOBE *CREATIVE CLD', -59.99),
  ]);
  assert.deepEqual(found, [{ key: 'ADOBE', amount: 59.99, dates: ['2026-09-12', '2026-09-14'] }]);
});

test('a bill far above its own steady usual is unusual; a jumpy shop is not', () => {
  const bills = [78.12, 84.5, 81.03, 142.37].map((amount, i) =>
    tx(`2026-0${7 + i}-18`.replace('-010-', '-10-'), 'PG&E WEB ONLINE', -amount),
  );
  const shop = [20, 90, 35, 160].map((amount, i) => tx(`2026-0${7 + i}-03`, 'SAFEWAY 1', -amount));
  const found = unusual([...bills, ...shop]);
  assert.equal(found.length, 1);
  assert.equal(found[0].amount, 142.37);
  assert.equal(found[0].usual, 81.03);
});
