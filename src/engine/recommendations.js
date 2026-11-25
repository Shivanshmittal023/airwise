/**
 * The decision engine. Turns live air data + a household profile into a
 * prioritised, explained plan. Deterministic and side-effect free, so the
 * GenAI layer only has to *communicate* decisions, never invent them.
 */
import { LEVEL, categorizeAqi, cigaretteEquivalent } from './aqi.js';
import { findCleanWindows, formatWindow } from './forecast.js';
import {
  COMMUTE_FACTORS,
  COOKING_FACTORS,
  HEATING_FACTORS,
  buildImpact,
  commuteSavings,
  cookingSavings,
  describeImpact,
  heatingSavings,
} from './impact.js';

const PERSONAL_RISK = Object.freeze([
  { id: 'low', label: 'Low' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'elevated', label: 'Elevated' },
  { id: 'high', label: 'High' },
  { id: 'very_high', label: 'Very high' },
  { id: 'severe', label: 'Severe' },
]);

const SENSITIVITY_LABELS = Object.freeze({
  children: 'children',
  elderly: 'older adults',
  respiratory: 'someone with asthma or a lung condition',
  cardiac: 'someone with a heart condition',
  pregnancy: 'a pregnant family member',
});

/** WHO 2021 air-quality guideline for 24-hour mean PM2.5 (µg/m³). */
export const WHO_PM25_24H_GUIDELINE = 15;

const PRIORITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });
const byPriority = (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];

const SOLID_FUEL_HEATING = new Set(['wood', 'coal', 'kerosene']);
const POLLUTING_COOKING = new Set(['biomass', 'kerosene']);
const PRIVATE_VEHICLES = new Set(['car', 'motorbike']);
const ACTIVE_MODES = new Set(['motorbike', 'bicycle', 'walk']);

const joinList = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Personal risk = outdoor AQI category, raised one level when the household
 * includes sensitive groups (from "Moderate" upwards, per EPA guidance).
 */
export function assessRisk(air, profile) {
  const { aqi, pm25 } = air.current;
  const category = categorizeAqi(aqi);
  const sensitiveGroups = profile.sensitivities.map((s) => SENSITIVITY_LABELS[s]);
  const bump = sensitiveGroups.length > 0 && category.index >= LEVEL.MODERATE ? 1 : 0;
  const personalIndex = Math.min(PERSONAL_RISK.length - 1, category.index + bump);
  const cigarettes = Number.isFinite(pm25) ? cigaretteEquivalent(pm25) : null;
  const whoMultiple = Number.isFinite(pm25) ? Math.round((pm25 / WHO_PM25_24H_GUIDELINE) * 10) / 10 : null;

  const explanation = [`The US AQI is ${aqi} (${category.label}).`];
  if (cigarettes !== null && cigarettes >= 0.5) {
    explanation.push(
      `Breathing PM2.5 at ${pm25} µg/m³ for a whole day is roughly like smoking ${cigarettes} cigarette${cigarettes === 1 ? '' : 's'}.`,
    );
  }
  if (bump) {
    explanation.push(`Your personal risk is one level higher because your household includes ${joinList(sensitiveGroups)}.`);
  }

  return {
    aqi,
    category: { id: category.id, label: category.label, index: category.index },
    personal: { ...PERSONAL_RISK[personalIndex], index: personalIndex },
    sensitiveGroups,
    cigarettes,
    whoMultiple,
    explanation: explanation.join(' '),
  };
}

function commuteRoutine(profile, risk) {
  if (profile.commuteMode === 'remote' || risk.category.index < LEVEL.USG) return null;
  const high = risk.personal.index >= LEVEL.UNHEALTHY ? 'high' : 'medium';
  if (profile.commuteMode === 'car' || profile.commuteMode === 'carpool') {
    return {
      id: 'commute-car',
      priority: high,
      title: 'Drive with windows up and air on recirculate',
      detail: 'Switch the AC to recirculation in traffic and keep a clean cabin filter; avoid idling with windows down.',
      why: 'In heavy traffic, in-car PM2.5 can exceed roadside levels because you sit in the exhaust plume of the vehicle ahead.',
    };
  }
  if (ACTIVE_MODES.has(profile.commuteMode)) {
    return {
      id: 'commute-route',
      priority: high,
      title: 'Take quieter back streets',
      detail: 'Choose routes away from arterial roads and junctions, and wear a sealed N95/FFP2 while riding or walking.',
      why: 'Traffic pollution falls sharply within 50–100 m of a busy road, so a parallel side street can noticeably cut your dose.',
    };
  }
  return {
    id: 'commute-transit',
    priority: 'medium',
    title: 'Wait indoors, not at roadside stops',
    detail: 'Wait inside stations or a few metres back from the kerb, and time departures to avoid the rush-hour peak when possible.',
    why: 'Bus stops on busy roads are exposure hot spots; a few metres of distance helps.',
  };
}

function exerciseRoutine(profile, risk, best) {
  if (!profile.exercisesOutdoors) return null;
  const p = risk.personal.index;
  if (p >= LEVEL.UNHEALTHY) {
    return {
      id: 'exercise',
      priority: 'high',
      title: 'Move workouts indoors today',
      detail: 'Swap runs or rides for an indoor routine (yoga, bodyweight circuits, stairs) with windows closed.',
      why: 'During exercise you breathe 5–10× more air, often through the mouth, pulling fine particles deep into the lungs.',
    };
  }
  if (p >= LEVEL.USG) {
    return {
      id: 'exercise',
      priority: 'medium',
      title: 'Keep outdoor exercise light and short',
      detail: best
        ? `Exercise at low intensity during ${formatWindow(best)}, in a park rather than beside traffic.`
        : 'Exercise at low intensity, in a park rather than beside traffic.',
      why: 'Lower intensity means lower breathing rate and a smaller dose of PM2.5.',
    };
  }
  return {
    id: 'exercise',
    priority: 'low',
    title: 'Outdoor exercise is fine today',
    detail: 'Prefer parks and green routes over roadside paths to keep exposure low.',
    why: 'Air is within healthy limits for most people right now.',
  };
}

/** Time-of-day plan: when to go out, how to commute, exercise and protect sensitive members. */
export function buildRoutine(profile, risk, windows) {
  const items = [];
  const [best] = windows.best;
  const { worst } = windows;
  const p = risk.personal.index;
  const has = (group) => profile.sensitivities.includes(group);

  if (best) {
    items.push({
      id: 'best-window',
      priority: risk.category.index >= LEVEL.USG ? 'high' : 'medium',
      title: `Plan outdoor time for ${formatWindow(best)}`,
      detail: `Forecast AQI averages ${best.avgAqi} (${best.label}) then — the cleanest daytime slot in the next 24 hours. Schedule school runs, errands and walks here.`,
      why: 'Winter smog is trapped near the ground by temperature inversions, so levels swing a lot through the day; timing alone can cut your exposure.',
    });
  }

  if (worst && worst.avgAqi > 100 && (!best || worst.avgAqi - best.avgAqi >= 20)) {
    items.push({
      id: 'avoid-window',
      priority: 'high',
      title: `Avoid being outside ${formatWindow(worst)}`,
      detail: `AQI is forecast to peak around ${worst.avgAqi} (${worst.label}) in this window.`,
      why: 'Peaks usually follow rush hour and evening inversions, when pollution has nowhere to disperse.',
    });
  }

  items.push(exerciseRoutine(profile, risk, best), commuteRoutine(profile, risk));

  // Masks only once outdoor air itself is unhealthy for sensitive groups (AQI > 100);
  // a sensitive household raises the urgency, not the threshold.
  if (risk.category.index >= LEVEL.USG) {
    const kids = has('children') ? ' For children use certified child-size masks; masks are not advised for children under 2.' : '';
    items.push({
      id: 'mask',
      priority: p >= LEVEL.UNHEALTHY ? 'high' : 'medium',
      title: 'Wear a well-fitted N95/FFP2 mask outdoors',
      detail: `Cloth and loose surgical masks let most fine particles through — check there are no gaps at the nose or cheeks.${kids}`,
      why: 'A properly sealed N95/FFP2 respirator filters at least 95% of fine particles.',
    });
  }

  if (has('children') && risk.category.index >= LEVEL.USG) {
    items.push({
      id: 'children',
      priority: 'high',
      title: "Protect children's developing lungs",
      detail: 'Keep outdoor play short and inside the cleanest window; ask the school about indoor recess on smog days.',
      why: 'Children breathe faster for their body size and their lungs are still developing, so the same air gives them a bigger dose.',
    });
  }

  if ((has('respiratory') || has('cardiac') || has('elderly')) && risk.category.index >= LEVEL.MODERATE) {
    items.push({
      id: 'medication',
      priority: risk.category.index >= LEVEL.USG ? 'high' : 'medium',
      title: 'Keep medication and an action plan within reach',
      detail: 'Carry inhalers or prescribed medicines and watch for wheezing, chest tightness, palpitations or breathlessness. Seek medical help if symptoms worsen.',
      why: 'Pollution spikes are a well-known trigger for asthma attacks and heart problems.',
    });
  }

  if (risk.category.index >= LEVEL.VERY_UNHEALTHY) {
    const wfh = profile.commuteMode !== 'remote' ? ' and ask to work or study from home if you can' : '';
    items.push({
      id: 'stay-indoors',
      priority: 'high',
      title: 'Stay indoors as much as possible',
      detail: `Postpone non-essential trips${wfh}.`,
      why: 'At this level everyone, not just sensitive groups, can experience health effects.',
    });
  }

  return items.filter(Boolean).sort(byPriority);
}

function purifierHack(profile, risk) {
  const smoggy = risk.category.index >= LEVEL.USG;
  if (profile.hasPurifier) {
    return {
      id: 'purifier',
      priority: smoggy ? 'high' : 'low',
      title: 'Run your purifier where you sleep',
      detail: 'Run it on high in the bedroom with the door closed. Aim for a CADR (m³/h) of about 5× the room volume, and replace the HEPA filter on schedule — sooner during heavy smog.',
      why: 'You spend about a third of the day in the bedroom, so a clean bedroom gives the biggest exposure cut per watt.',
    };
  }
  if (smoggy) {
    return {
      id: 'purifier',
      priority: 'high',
      title: 'Build a low-cost DIY box-fan filter',
      detail: 'Tape a MERV-13 (or better) filter to the intake side of a box or table fan and run it in the main room. Upgrade to a HEPA purifier sized for your bedroom when you can.',
      why: 'Tests of DIY fan-filter units (Corsi–Rosenthal style) show large cuts in indoor PM2.5 for a fraction of the cost of a commercial purifier.',
    };
  }
  return {
    id: 'purifier',
    priority: 'low',
    title: 'Get a HEPA purifier before peak smog season',
    detail: 'Pick one with a CADR suited to your bedroom size; it will matter most on the worst winter days.',
    why: 'Filtration is the most effective way to clean indoor air when outdoor air is polluted.',
  };
}

function ventilationHack(risk, best) {
  const idx = risk.category.index;
  if (idx >= LEVEL.USG) {
    return {
      id: 'ventilation',
      priority: 'high',
      title: 'Keep windows shut; air out briefly at the cleanest hour',
      detail: best
        ? `Open windows for 10–15 minutes around ${best.start}${best.day === 'tomorrow' ? ' tomorrow' : ''} to flush out CO₂ and cooking fumes, then close them again.`
        : 'Open windows only briefly (10–15 minutes) to flush out CO₂ and cooking fumes, then close them again.',
      why: 'Outdoor PM2.5 seeps in through open windows; short, well-timed airing balances fresh air against smog.',
    };
  }
  if (idx === LEVEL.MODERATE) {
    return {
      id: 'ventilation',
      priority: 'medium',
      title: 'Ventilate in moderation',
      detail: 'Air out rooms for short spells, ideally away from rush hour.',
      why: 'Air is acceptable for most people; brief ventilation keeps indoor pollutants and CO₂ down.',
    };
  }
  return {
    id: 'ventilation',
    priority: 'medium',
    title: 'Open up and ventilate now',
    detail: 'Cross-ventilate for 15–30 minutes while outdoor air is clean.',
    why: 'Right now outdoor air is likely cleaner than indoor air, so this is a good chance to flush indoor pollutants.',
  };
}

function cookingHack(profile) {
  if (POLLUTING_COOKING.has(profile.cooking)) {
    return {
      id: 'cooking',
      priority: 'high',
      title: 'Cook with maximum ventilation and keep others away',
      detail: 'Cook near an open window or outdoors if possible, use a chimney or hood, and keep children and elderly relatives out of the kitchen while the fire is lit.',
      why: `A ${COOKING_FACTORS[profile.cooking].label} is one of the largest sources of indoor PM2.5 — often worse than the smog outside.`,
    };
  }
  return {
    id: 'cooking',
    priority: profile.cooking === 'gas' ? 'medium' : 'low',
    title: 'Use the exhaust hood every time you cook',
    detail: 'Run the chimney or hood on high, keep lids on pans and use back burners. On smoggy days prefer steaming or boiling over deep-frying.',
    why: profile.cooking === 'gas'
      ? 'Gas burners emit nitrogen dioxide and frying releases fine particles; indoor levels can spike above the smog outside.'
      : 'Even on induction, frying and roasting release fine particles.',
  };
}

function heatingHack(profile) {
  if (!SOLID_FUEL_HEATING.has(profile.heating)) return null;
  return {
    id: 'heating',
    priority: 'high',
    title: 'Make combustion heating safer',
    detail: 'Check the flue draws properly, burn only dry fuel, never burn plastic or rubbish, keep a window slightly open when burning, and fit a carbon-monoxide alarm.',
    why: `A ${HEATING_FACTORS[profile.heating].label} releases fine particles and carbon monoxide straight into or next to your home.`,
  };
}

/** Indoor air actions, tailored to equipment, fuels and today's outdoor level. */
export function buildIndoorHacks(profile, risk, windows) {
  const smoggy = risk.category.index >= LEVEL.USG;
  const items = [
    ventilationHack(risk, windows.best[0]),
    purifierHack(profile, risk),
    cookingHack(profile),
    heatingHack(profile),
    {
      id: 'indoor-sources',
      priority: smoggy ? 'high' : 'medium',
      title: 'Cut indoor smoke sources',
      detail: 'Skip incense, candles, mosquito coils and indoor smoking, especially on smog days.',
      why: 'These can add more PM2.5 indoors than the smog outside — and you are already breathing that.',
    },
    {
      id: 'wet-cleaning',
      priority: 'medium',
      title: 'Clean wet, not dry',
      detail: 'Damp-mop floors and wipe surfaces instead of sweeping or dusting, and leave shoes at the door.',
      why: 'Sweeping and dusting re-suspend settled particles back into the air you breathe.',
    },
  ];

  if (risk.category.index >= LEVEL.UNHEALTHY) {
    items.push({
      id: 'seal-gaps',
      priority: 'medium',
      title: 'Seal draughts around windows and doors',
      detail: 'Use weather-stripping or draft stoppers; a rolled towel under the door helps in a pinch.',
      why: 'Fewer leaks means less smog infiltration and lets your purifier keep up.',
    });
  }

  items.push({
    id: 'plants',
    priority: 'low',
    title: "Don't rely on houseplants to clean the air",
    detail: 'Enjoy them, but put your money into filtration instead.',
    why: 'Studies estimate you would need hundreds of plants per room to match even a small purifier.',
  });

  return items.filter(Boolean).sort(byPriority);
}

function commuteAlternatives(profile, risk) {
  const { commuteMode, commuteKm } = profile;
  if (!PRIVATE_VEHICLES.has(commuteMode) || commuteKm <= 0) return [];

  const targets = ['metro', 'bus'];
  if (commuteKm <= 8 && risk.category.index <= LEVEL.MODERATE) targets.unshift('bicycle');
  if (commuteMode === 'car') targets.push('carpool');

  return targets.map((to) => {
    const impact = commuteSavings(commuteMode, to, commuteKm);
    return {
      id: `commute-${to}`,
      category: 'commute',
      priority: 'medium',
      title: `Switch your ${commuteKm} km ${COMMUTE_FACTORS[commuteMode].label} commute to ${COMMUTE_FACTORS[to].label}`,
      detail: to === 'bicycle'
        ? 'Air is clean enough today for active travel — and you skip the traffic.'
        : 'Even a few days a week makes a dent; pair it with a sealed mask on smoggy days.',
      impact,
      explanation: describeImpact(impact),
    };
  });
}

/** Low-emission swaps with quantified, explained impact. */
export function buildAlternatives(profile, risk) {
  const items = [...commuteAlternatives(profile, risk)];

  if (profile.commuteMode !== 'remote' && profile.commuteKm > 0 && risk.category.index >= LEVEL.UNHEALTHY) {
    const impact = commuteSavings(profile.commuteMode, 'remote', profile.commuteKm, 4);
    items.push({
      id: 'remote-days',
      category: 'commute',
      priority: 'medium',
      title: 'Work or study from home on the worst smog days',
      detail: 'Assumes 4 severe-smog days a month. It cuts both your exposure and the traffic emissions that feed the smog.',
      impact,
      explanation: describeImpact(impact),
    });
  }

  if (SOLID_FUEL_HEATING.has(profile.heating)) {
    for (const to of ['heat_pump', 'electric']) {
      const impact = heatingSavings(profile.heating, to);
      items.push({
        id: `heating-${to}`,
        category: 'heating',
        priority: 'high',
        title: `Replace your ${HEATING_FACTORS[profile.heating].label} with a ${HEATING_FACTORS[to].label}`,
        detail: to === 'heat_pump'
          ? 'Inverter ACs with heating mode use ~3× less electricity than plain heaters and emit nothing indoors.'
          : 'A cheaper upfront option with zero indoor emissions.',
        impact,
        explanation: describeImpact(impact),
      });
    }
  }

  if (POLLUTING_COOKING.has(profile.cooking)) {
    for (const to of ['gas', 'electric']) {
      const impact = cookingSavings(profile.cooking, to);
      items.push({
        id: `cooking-${to}`,
        category: 'cooking',
        priority: 'high',
        title: `Switch from a ${COOKING_FACTORS[profile.cooking].label} to ${COOKING_FACTORS[to].label}`,
        detail: 'Check for clean-cooking subsidies in your area (for example, LPG connection schemes).',
        impact,
        explanation: describeImpact(impact),
      });
    }
  }

  if (PRIVATE_VEHICLES.has(profile.commuteMode)) {
    items.push({
      id: 'no-idling',
      category: 'driving',
      priority: 'low',
      title: 'Switch off at long signals and keep tyres inflated',
      detail: 'Turn the engine off for stops over ~10 seconds, combine errands into one trip and service the vehicle regularly.',
      impact: null,
      explanation: 'Idling and under-inflated tyres waste fuel and add exhaust right where people are walking.',
    });
  }

  items.push({
    id: 'no-burning',
    category: 'community',
    priority: 'low',
    title: 'Never burn leaves or rubbish — compost and report open burning',
    detail: 'Bag or compost garden waste and report open burning to your local authority.',
    impact: null,
    explanation: 'Open burning is a major winter smog source in many cities, and it releases toxic smoke right at street level.',
  });

  return items.sort(byPriority);
}

/**
 * Combined potential impact: the single best switch per category (commute,
 * heating, cooking), ranked by PM2.5 avoided then CO₂, summed. Picking one per
 * category avoids double counting mutually exclusive options.
 * @returns {{co2KgPerMonth: number, pm25GPerMonth: number, treesEquivalent: number, switches: number} | null}
 */
export function summarizeImpact(alternatives) {
  const bestByCategory = new Map();
  for (const item of alternatives) {
    if (!item.impact) continue;
    const current = bestByCategory.get(item.category);
    const better = !current
      || item.impact.pm25GPerMonth > current.impact.pm25GPerMonth
      || (item.impact.pm25GPerMonth === current.impact.pm25GPerMonth && item.impact.co2KgPerMonth > current.impact.co2KgPerMonth);
    if (better) bestByCategory.set(item.category, item);
  }
  if (bestByCategory.size === 0) return null;

  let co2 = 0;
  let pm25 = 0;
  for (const { impact } of bestByCategory.values()) {
    co2 += impact.co2KgPerMonth;
    pm25 += impact.pm25GPerMonth;
  }
  return { ...buildImpact(co2, pm25), switches: bestByCategory.size };
}

/**
 * Build the full plan.
 * @param {{current: {aqi: number, pm25: number|null, time: string}, hourly: {time: string, aqi: number}[]}} air
 * @param {object} profile validated profile
 */
export function buildPlan(air, profile) {
  const risk = assessRisk(air, profile);
  const windows = findCleanWindows(air.hourly, air.current.time);
  const alternatives = buildAlternatives(profile, risk);
  return {
    risk,
    windows,
    routine: buildRoutine(profile, risk, windows),
    indoor: buildIndoorHacks(profile, risk, windows),
    alternatives,
    impactSummary: summarizeImpact(alternatives),
  };
}
