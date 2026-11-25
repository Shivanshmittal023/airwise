import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateProfile } from '../src/engine/profile.js';

describe('validateProfile', () => {
  it('accepts a minimal city profile and applies safe defaults', () => {
    const result = validateProfile({ city: '  New   Delhi ' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      location: { city: 'New Delhi' },
      sensitivities: [],
      commuteMode: 'remote',
      commuteKm: 0,
      heating: 'none',
      cooking: 'gas',
      hasPurifier: false,
      exercisesOutdoors: false,
      question: undefined,
    });
  });

  it('accepts coordinates and rounds them to ~1 km for privacy', () => {
    const result = validateProfile({ latitude: 28.613939, longitude: 77.209023 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.location, { latitude: 28.61, longitude: 77.21 });
  });

  it('accepts international city names', () => {
    assert.equal(validateProfile({ city: 'São Paulo' }).ok, true);
    assert.equal(validateProfile({ city: 'दिल्ली' }).ok, true);
    assert.equal(validateProfile({ city: "Xi'an" }).ok, true);
  });

  it('requires a location', () => {
    const result = validateProfile({});
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /city name or share your location/);
  });

  it('rejects markup and injection-looking city input', () => {
    for (const city of ['<script>alert(1)</script>', 'a', '../../etc/passwd', 'x'.repeat(81)]) {
      assert.equal(validateProfile({ city }).ok, false, city);
    }
  });

  it('rejects out-of-range coordinates', () => {
    const result = validateProfile({ latitude: 91, longitude: 200 });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });

  it('whitelists enums, booleans and sensitivities', () => {
    const result = validateProfile({
      city: 'Lahore',
      commuteMode: 'teleport',
      heating: 'plutonium',
      cooking: 'lava',
      hasPurifier: 'yes',
      sensitivities: ['children', 'aliens'],
      commuteKm: 500,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 6);
  });

  it('deduplicates sensitivities and zeroes distance for remote workers', () => {
    const result = validateProfile({ city: 'Beijing', sensitivities: ['children', 'children'], commuteMode: 'remote', commuteKm: 12 });
    assert.deepEqual(result.value.sensitivities, ['children']);
    assert.equal(result.value.commuteKm, 0);
  });

  it('requires and sanitises the question when asked to', () => {
    assert.equal(validateProfile({ city: 'Delhi' }, { requireQuestion: true }).ok, false);
    const result = validateProfile({ city: 'Delhi', question: 'Can I\u0000 run\n today?' }, { requireQuestion: true });
    assert.equal(result.value.question, 'Can I run today?');
    assert.equal(validateProfile({ city: 'Delhi', question: 'x'.repeat(501) }).ok, false);
  });

  it('rejects non-object bodies', () => {
    assert.equal(validateProfile(null).ok, false);
    assert.equal(validateProfile(['Delhi']).ok, false);
    assert.equal(validateProfile('Delhi').ok, false);
  });
});
