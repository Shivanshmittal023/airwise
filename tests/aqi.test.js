import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { categorizeAqi, cigaretteEquivalent, pm25ToAqi } from '../src/engine/aqi.js';

describe('categorizeAqi', () => {
  it('maps boundary values to the correct EPA category', () => {
    assert.equal(categorizeAqi(0).id, 'good');
    assert.equal(categorizeAqi(50).id, 'good');
    assert.equal(categorizeAqi(51).id, 'moderate');
    assert.equal(categorizeAqi(100).id, 'moderate');
    assert.equal(categorizeAqi(101).id, 'usg');
    assert.equal(categorizeAqi(151).id, 'unhealthy');
    assert.equal(categorizeAqi(201).id, 'very_unhealthy');
    assert.equal(categorizeAqi(301).id, 'hazardous');
    assert.equal(categorizeAqi(999).id, 'hazardous');
  });

  it('exposes an ordinal index for decision rules', () => {
    assert.equal(categorizeAqi(10).index, 0);
    assert.equal(categorizeAqi(400).index, 5);
  });

  it('rejects invalid input', () => {
    assert.throws(() => categorizeAqi(-1), RangeError);
    assert.throws(() => categorizeAqi(Number.NaN), RangeError);
  });
});

describe('pm25ToAqi', () => {
  it('converts using the 2024 EPA breakpoints', () => {
    assert.equal(pm25ToAqi(0), 0);
    assert.equal(pm25ToAqi(9.0), 50);
    assert.equal(pm25ToAqi(35.4), 100);
    assert.equal(pm25ToAqi(55.4), 150);
    assert.equal(pm25ToAqi(125.4), 200);
  });

  it('truncates to one decimal like the EPA does', () => {
    assert.equal(pm25ToAqi(9.05), 50);
  });

  it('caps extreme values at 500 and rejects bad input', () => {
    assert.equal(pm25ToAqi(1000), 500);
    assert.equal(pm25ToAqi(null), null);
    assert.equal(pm25ToAqi(-5), null);
  });
});

describe('cigaretteEquivalent', () => {
  it('uses the 22 µg/m³ ≈ 1 cigarette rule', () => {
    assert.equal(cigaretteEquivalent(22), 1);
    assert.equal(cigaretteEquivalent(110), 5);
    assert.equal(cigaretteEquivalent(0), 0);
  });
});
