import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDue } from '../src/jobs/due.ts';

// 2026-10-14 is a Wednesday.
const written = '2026-10-14';

test('a weekday is the next one after the note', () => {
  assert.equal(resolveDue('fri', written), '2026-10-16');
  assert.equal(resolveDue('by Friday', written), '2026-10-16');
  assert.equal(resolveDue('wednesday', written), '2026-10-21');
  assert.equal(resolveDue('next monday', written), '2026-10-26');
  assert.equal(resolveDue('before thursday', written), '2026-10-15');
});

test('days and dates in their usual words', () => {
  assert.equal(resolveDue('tomorrow', written), '2026-10-15');
  assert.equal(resolveDue('today', written), written);
  assert.equal(resolveDue('oct 31', written), '2026-10-31');
  assert.equal(resolveDue('by October 31st', written), '2026-10-31');
  assert.equal(resolveDue('jan 10', written), '2027-01-10');
  assert.equal(resolveDue('11/14', written), '2026-11-14');
  assert.equal(resolveDue('2026-12-01', written), '2026-12-01');
});

test('no day named, no date', () => {
  assert.equal(resolveDue('soon', written), null);
  assert.equal(resolveDue(null, written), null);
  assert.equal(resolveDue('in november', written), null);
});
