import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeForecast,
  formatLocalTime,
  gaugeOffset,
  iconForItem,
  impactChips,
  levelIdForAqi,
  placeLabel,
  upcomingHours,
} from '../public/js/format.js';
import { makeAir } from './fixtures.js';

describe('frontend formatting helpers', () => {
  it('maps AQI to the same level ids as the engine', () => {
    assert.equal(levelIdForAqi(0), 'good');
    assert.equal(levelIdForAqi(100), 'moderate');
    assert.equal(levelIdForAqi(101), 'usg');
    assert.equal(levelIdForAqi(250), 'very_unhealthy');
    assert.equal(levelIdForAqi(450), 'hazardous');
  });

  it('computes the gauge fill, clamped to 0–300', () => {
    assert.equal(gaugeOffset(0), 100);
    assert.equal(gaugeOffset(150), 50);
    assert.equal(gaugeOffset(999), 0);
    assert.equal(gaugeOffset(-5), 100);
    assert.equal(gaugeOffset('bad'), 100);
  });

  it('builds readable impact chips, including CO₂ increases', () => {
    assert.deepEqual(impactChips({ co2KgPerMonth: 61.6, pm25GPerMonth: 14.5, treesEquivalent: 35 }), [
      '−61.6 kg CO₂/mo',
      '−14.5 g PM2.5/mo',
      '≈ 35 trees/yr',
    ]);
    assert.deepEqual(impactChips({ co2KgPerMonth: -6, pm25GPerMonth: 445.5, treesEquivalent: 0 }), ['+6 kg CO₂/mo', '−445.5 g PM2.5/mo']);
    assert.deepEqual(impactChips(null), []);
  });

  it('picks icons by item id, then category, then a default', () => {
    assert.equal(iconForItem({ id: 'mask' }), 'shield');
    assert.equal(iconForItem({ id: 'heating-heat_pump', category: 'heating' }), 'thermometer');
    assert.equal(iconForItem({ id: 'unknown' }), 'check');
  });

  it('formats places and times', () => {
    assert.equal(placeLabel({ name: 'Delhi', region: null, country: 'India' }), 'Delhi, India');
    assert.equal(formatLocalTime('2026-11-25T09:00'), '25 Nov, 09:00');
    assert.equal(formatLocalTime('garbage'), 'garbage');
  });

  it('describes the forecast for screen readers', () => {
    const air = makeAir({ time: '2026-11-25T08:00' });
    const hours = upcomingHours(air);
    assert.equal(hours.length, 24);
    assert.equal(hours[0].time, '2026-11-25T08:00');
    const text = describeForecast(hours, { start: '14:00', end: '16:00', day: 'today' });
    assert.match(text, /ranges from 140 at 14:00 to 340 at 20:00/);
    assert.match(text, /Cleanest daytime window: 14:00 to 16:00 today/);
    assert.equal(describeForecast([], null), 'No forecast available.');
  });
});
