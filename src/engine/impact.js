/**
 * Indicative emission factors and impact maths.
 *
 * Values are rounded, order-of-magnitude estimates drawn from public sources
 * (UK DEFRA GHG conversion factors, EEA/EMEP emission inventory guidebook,
 * WHO household-energy data). They are meant to compare choices, not to audit.
 */

export const WORKDAYS_PER_MONTH = 22;
export const DAYS_PER_MONTH = 30;
/** A mature tree absorbs roughly 21 kg of CO₂ per year. */
export const TREE_CO2_KG_PER_YEAR = 21;

/** Per passenger-km. PM2.5 includes exhaust plus brake/tyre wear. */
export const COMMUTE_FACTORS = Object.freeze({
  car: { label: 'car', co2KgPerKm: 0.17, pm25GPerKm: 0.035 },
  carpool: { label: 'shared car (2 people)', co2KgPerKm: 0.085, pm25GPerKm: 0.0175 },
  motorbike: { label: 'motorbike/scooter', co2KgPerKm: 0.11, pm25GPerKm: 0.04 },
  bus: { label: 'bus', co2KgPerKm: 0.1, pm25GPerKm: 0.01 },
  metro: { label: 'metro/train', co2KgPerKm: 0.03, pm25GPerKm: 0.002 },
  bicycle: { label: 'bicycle', co2KgPerKm: 0, pm25GPerKm: 0 },
  walk: { label: 'walking', co2KgPerKm: 0, pm25GPerKm: 0 },
  remote: { label: 'working from home', co2KgPerKm: 0, pm25GPerKm: 0 },
});

/** Typical winter day of heating a room for a household. */
export const HEATING_FACTORS = Object.freeze({
  none: { label: 'no heating', co2KgPerDay: 0, pm25GPerDay: 0 },
  wood: { label: 'wood stove or open fire', co2KgPerDay: 1.5, pm25GPerDay: 60 },
  coal: { label: 'coal stove', co2KgPerDay: 12, pm25GPerDay: 20 },
  kerosene: { label: 'kerosene heater', co2KgPerDay: 7.5, pm25GPerDay: 3 },
  gas: { label: 'gas heater', co2KgPerDay: 4.5, pm25GPerDay: 0.1 },
  electric: { label: 'electric heater', co2KgPerDay: 6, pm25GPerDay: 0 },
  heat_pump: { label: 'heat pump / inverter AC', co2KgPerDay: 2, pm25GPerDay: 0 },
});

/** Typical household day of cooking. */
export const COOKING_FACTORS = Object.freeze({
  gas: { label: 'LPG/piped gas', co2KgPerDay: 1, pm25GPerDay: 0.3 },
  electric: { label: 'induction/electric', co2KgPerDay: 1.2, pm25GPerDay: 0.05 },
  kerosene: { label: 'kerosene stove', co2KgPerDay: 1.5, pm25GPerDay: 2 },
  biomass: { label: 'wood/biomass stove', co2KgPerDay: 0.5, pm25GPerDay: 15 },
});

const round = (value, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0; // `+ 0` normalises -0
};

function lookup(table, key, kind) {
  const factor = table[key];
  if (!factor) throw new RangeError(`Unknown ${kind}: ${key}`);
  return factor;
}

/**
 * @param {number} co2KgPerMonth positive = saving
 * @param {number} pm25GPerMonth positive = saving
 */
export function buildImpact(co2KgPerMonth, pm25GPerMonth) {
  return {
    co2KgPerMonth: round(co2KgPerMonth),
    pm25GPerMonth: round(pm25GPerMonth),
    treesEquivalent: Math.max(0, Math.round((co2KgPerMonth * 12) / TREE_CO2_KG_PER_YEAR)),
  };
}

/** Monthly savings from switching a round-trip commute between two modes. */
export function commuteSavings(fromMode, toMode, oneWayKm, days = WORKDAYS_PER_MONTH) {
  const from = lookup(COMMUTE_FACTORS, fromMode, 'commute mode');
  const to = lookup(COMMUTE_FACTORS, toMode, 'commute mode');
  const kmPerMonth = oneWayKm * 2 * days;
  return buildImpact(
    (from.co2KgPerKm - to.co2KgPerKm) * kmPerMonth,
    (from.pm25GPerKm - to.pm25GPerKm) * kmPerMonth,
  );
}

/** Monthly savings from switching heating type during the cold season. */
export function heatingSavings(fromType, toType, days = DAYS_PER_MONTH) {
  const from = lookup(HEATING_FACTORS, fromType, 'heating type');
  const to = lookup(HEATING_FACTORS, toType, 'heating type');
  return buildImpact((from.co2KgPerDay - to.co2KgPerDay) * days, (from.pm25GPerDay - to.pm25GPerDay) * days);
}

/** Monthly savings from switching cooking fuel. */
export function cookingSavings(fromFuel, toFuel, days = DAYS_PER_MONTH) {
  const from = lookup(COOKING_FACTORS, fromFuel, 'cooking fuel');
  const to = lookup(COOKING_FACTORS, toFuel, 'cooking fuel');
  return buildImpact((from.co2KgPerDay - to.co2KgPerDay) * days, (from.pm25GPerDay - to.pm25GPerDay) * days);
}

/** Plain-language explanation of an impact object. */
export function describeImpact({ co2KgPerMonth, pm25GPerMonth, treesEquivalent }) {
  const parts = [];
  if (pm25GPerMonth > 0) parts.push(`cuts about ${pm25GPerMonth} g of PM2.5 emissions`);
  if (co2KgPerMonth > 0) parts.push(`saves ~${co2KgPerMonth} kg of CO₂`);
  if (co2KgPerMonth < 0) parts.push(`adds ~${-co2KgPerMonth} kg of CO₂ from grid power`);
  if (parts.length === 0) return 'Little measurable change in emissions.';
  let sentence = `Each month this ${parts.join(' and ')}.`;
  if (treesEquivalent >= 1) {
    sentence += ` Over a year, the CO₂ saved equals what ~${treesEquivalent} mature trees absorb.`;
  }
  return sentence;
}
