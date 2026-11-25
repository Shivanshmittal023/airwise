import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findCleanWindows, formatWindow } from '../src/engine/forecast.js';
import { SMOGGY_DAY, hourlySeries } from './fixtures.js';

const twoDays = [...hourlySeries('2026-11-25', SMOGGY_DAY), ...hourlySeries('2026-11-26', SMOGGY_DAY)];

describe('findCleanWindows', () => {
  it('finds the cleanest daytime window in the next 24 hours', () => {
    const { best, worst } = findCleanWindows(twoDays, '2026-11-25T08:30');
    // 14:00 (140) + 15:00 (145) → avg 143
    assert.equal(best[0].start, '14:00');
    assert.equal(best[0].end, '16:00');
    assert.equal(best[0].avgAqi, 143);
    assert.equal(best[0].day, 'today');
    assert.equal(worst.start, '19:00');
  });

  it('returns non-overlapping windows', () => {
    const { best } = findCleanWindows(twoDays, '2026-11-25T08:00');
    assert.equal(best.length, 2);
    const [a, b] = best;
    assert.ok(a.date !== b.date || Math.abs(a.startHour - b.startHour) >= 2);
  });

  it('rolls over to tomorrow late in the evening', () => {
    const { best } = findCleanWindows(twoDays, '2026-11-25T22:10');
    assert.equal(best[0].day, 'tomorrow');
    assert.equal(formatWindow(best[0]), '14:00–16:00 tomorrow');
  });

  it('ignores night hours', () => {
    const { best } = findCleanWindows(twoDays, '2026-11-25T00:00');
    for (const w of best) assert.ok(w.startHour >= 6 && w.startHour <= 19);
  });

  it('handles empty or missing data', () => {
    assert.deepEqual(findCleanWindows([], '2026-11-25T08:00'), { best: [], worst: null });
    assert.deepEqual(findCleanWindows(undefined, '2026-11-25T08:00'), { best: [], worst: null });
  });
});
