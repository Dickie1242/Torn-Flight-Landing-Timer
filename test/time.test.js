import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatElapsed, formatClock, formatMinutes } from '../src/core/time.js';
import { realClock } from '../src/core/clock.js';

test('a countdown is m:ss under an hour and h:mm:ss from an hour, rounded up', () => {
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(1), '0:01', 'a part second still to go shows as a second');
  assert.equal(formatCountdown(999), '0:01');
  assert.equal(formatCountdown(61_000), '1:01');
  assert.equal(formatCountdown(25 * 60_000), '25:00');
  assert.equal(formatCountdown(3_600_000), '1:00:00');
  assert.equal(formatCountdown(2 * 3_600_000 + 3 * 60_000 + 10_000), '2:03:10');
  assert.equal(formatCountdown(-5_000), '0:00', 'past due counts as zero');
});

test('elapsed time is rounded down', () => {
  assert.equal(formatElapsed(35_400), '0:35');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-1), '0:00');
});

test('a clock time is local HH:MM', () => {
  assert.equal(formatClock(new Date(2026, 9, 2, 14, 37).getTime()), '14:37');
  assert.equal(formatClock(new Date(2026, 9, 2, 9, 5).getTime()), '09:05');
});

test('minutes read the way the Torn wiki writes them', () => {
  assert.equal(formatMinutes(27), '27 min');
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(127), '2h 7min');
  assert.equal(formatMinutes(180), '3h');
  assert.equal(formatMinutes(24.6), '25 min');
});

test('the real clock tells the real time', () => {
  const before = Date.now();
  const now = realClock.now();
  assert.ok(now >= before && now <= Date.now());
  const handle = realClock.setTimeout(() => {}, 1000);
  realClock.clearTimeout(handle);
});
