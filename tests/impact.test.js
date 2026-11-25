import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commuteSavings, cookingSavings, describeImpact, heatingSavings } from '../src/engine/impact.js';

describe('commuteSavings', () => {
  it('computes monthly round-trip savings for car → metro', () => {
    // 10 km × 2 × 22 days = 440 km; (0.17 − 0.03) × 440 = 61.6 kg
    const impact = commuteSavings('car', 'metro', 10);
    assert.equal(impact.co2KgPerMonth, 61.6);
    assert.equal(impact.pm25GPerMonth, 14.5);
    assert.equal(impact.treesEquivalent, 35);
  });

  it('returns zero when nothing changes', () => {
    const impact = commuteSavings('bus', 'bus', 12);
    assert.deepEqual(impact, { co2KgPerMonth: 0, pm25GPerMonth: 0, treesEquivalent: 0 });
  });

  it('rejects unknown modes', () => {
    assert.throws(() => commuteSavings('rocket', 'bus', 5), RangeError);
  });
});

describe('heating and cooking savings', () => {
  it('shows large PM2.5 cuts when leaving wood heating', () => {
    const impact = heatingSavings('wood', 'heat_pump');
    assert.equal(impact.pm25GPerMonth, 1800);
  });

  it('can report a CO₂ increase honestly (biomass → electric)', () => {
    const impact = cookingSavings('biomass', 'electric');
    assert.ok(impact.co2KgPerMonth < 0);
    assert.ok(impact.pm25GPerMonth > 0);
    assert.match(describeImpact(impact), /adds ~\d+(\.\d)? kg of CO₂/);
  });
});

describe('describeImpact', () => {
  it('explains savings in plain language with a tree comparison', () => {
    const text = describeImpact({ co2KgPerMonth: 61.6, pm25GPerMonth: 14.5, treesEquivalent: 35 });
    assert.match(text, /cuts about 14.5 g of PM2.5/);
    assert.match(text, /saves ~61.6 kg of CO₂/);
    assert.match(text, /35 mature trees/);
  });

  it('handles no change', () => {
    assert.equal(describeImpact({ co2KgPerMonth: 0, pm25GPerMonth: 0, treesEquivalent: 0 }), 'Little measurable change in emissions.');
  });
});
