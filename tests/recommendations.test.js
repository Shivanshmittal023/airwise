import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessRisk, buildPlan } from '../src/engine/recommendations.js';
import { makeAir, makeProfile } from './fixtures.js';

const ids = (items) => items.map((item) => item.id);
const find = (items, id) => items.find((item) => item.id === id);

describe('assessRisk', () => {
  it('raises personal risk one level for sensitive households', () => {
    const air = makeAir({ aqi: 120, pm25: 44 });
    const general = assessRisk(air, makeProfile());
    const family = assessRisk(air, makeProfile({ sensitivities: ['children', 'respiratory'] }));
    assert.equal(general.personal.id, 'elevated');
    assert.equal(family.personal.id, 'high');
    assert.match(family.explanation, /children and someone with asthma/);
  });

  it('does not raise risk when air is good', () => {
    const risk = assessRisk(makeAir({ aqi: 30, pm25: 7 }), makeProfile({ sensitivities: ['elderly'] }));
    assert.equal(risk.personal.id, 'low');
  });

  it('explains exposure in cigarette equivalents', () => {
    const risk = assessRisk(makeAir({ aqi: 180, pm25: 110 }), makeProfile());
    assert.equal(risk.cigarettes, 5);
    assert.match(risk.explanation, /5 cigarettes/);
  });
});

describe('buildPlan – smoggy day, sensitive family', () => {
  const profile = makeProfile({
    sensitivities: ['children', 'respiratory'],
    commuteMode: 'car',
    commuteKm: 12,
    heating: 'wood',
    cooking: 'gas',
    exercisesOutdoors: true,
  });
  const plan = buildPlan(makeAir({ aqi: 240, pm25: 160 }), profile);

  it('moves exercise indoors and recommends masks', () => {
    assert.equal(find(plan.routine, 'exercise').title, 'Move workouts indoors today');
    assert.equal(find(plan.routine, 'mask').priority, 'high');
  });

  it('protects children and people with lung conditions', () => {
    assert.ok(ids(plan.routine).includes('children'));
    assert.ok(ids(plan.routine).includes('medication'));
    assert.ok(ids(plan.routine).includes('stay-indoors'));
  });

  it('times outdoor activity to the cleanest window', () => {
    assert.equal(find(plan.routine, 'best-window').title, 'Plan outdoor time for 14:00–16:00');
    assert.ok(find(plan.routine, 'avoid-window'));
  });

  it('keeps windows shut and suggests a DIY filter when there is no purifier', () => {
    assert.match(find(plan.indoor, 'ventilation').title, /Keep windows shut/);
    assert.match(find(plan.indoor, 'purifier').title, /DIY/);
    assert.ok(find(plan.indoor, 'heating'));
    assert.ok(find(plan.indoor, 'seal-gaps'));
  });

  it('suggests quantified low-emission switches', () => {
    const metro = find(plan.alternatives, 'commute-metro');
    assert.ok(metro.impact.co2KgPerMonth > 0);
    assert.match(metro.explanation, /kg of CO₂/);
    assert.ok(find(plan.alternatives, 'heating-heat_pump'));
    assert.ok(find(plan.alternatives, 'remote-days'));
    // Cycling is not suggested on a very unhealthy day.
    assert.equal(find(plan.alternatives, 'commute-bicycle'), undefined);
  });

  it('sorts every list by priority', () => {
    const rank = { high: 0, medium: 1, low: 2 };
    for (const list of [plan.routine, plan.indoor, plan.alternatives]) {
      const ranks = list.map((item) => rank[item.priority]);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    }
  });
});

describe('buildPlan – clean day, low-emission household', () => {
  const profile = makeProfile({ commuteMode: 'car', commuteKm: 5, hasPurifier: true, exercisesOutdoors: true, cooking: 'electric' });
  const hourly = makeAir().hourly.map((h) => ({ ...h, aqi: 30 }));
  const plan = buildPlan(makeAir({ aqi: 35, pm25: 8, hourly }), profile);

  it('encourages ventilation and outdoor exercise', () => {
    assert.equal(find(plan.indoor, 'ventilation').title, 'Open up and ventilate now');
    assert.equal(find(plan.routine, 'exercise').priority, 'low');
    assert.equal(find(plan.routine, 'mask'), undefined);
  });

  it('suggests cycling for short commutes when air is clean', () => {
    assert.equal(plan.alternatives[0].id, 'commute-bicycle');
  });

  it('does not suggest fuel switches that are not needed', () => {
    assert.equal(find(plan.alternatives, 'heating-heat_pump'), undefined);
    assert.equal(find(plan.alternatives, 'cooking-gas'), undefined);
  });
});

describe('buildPlan – moderate air, sensitive household', () => {
  const plan = buildPlan(makeAir({ aqi: 55, pm25: 15.8 }), makeProfile({ sensitivities: ['children'] }));

  it('raises personal risk but does not over-prescribe masks', () => {
    assert.equal(plan.risk.personal.id, 'elevated');
    assert.equal(find(plan.routine, 'mask'), undefined);
    assert.equal(find(plan.routine, 'best-window').priority, 'medium');
  });
});

describe('buildPlan – solid-fuel cooking', () => {
  it('flags biomass cooking as a high-priority indoor risk and switch', () => {
    const plan = buildPlan(makeAir({ aqi: 90, pm25: 30 }), makeProfile({ cooking: 'biomass' }));
    assert.equal(find(plan.indoor, 'cooking').priority, 'high');
    assert.ok(find(plan.alternatives, 'cooking-gas').impact.pm25GPerMonth > 0);
  });
});
