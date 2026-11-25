/**
 * Air Quality Index helpers based on the US EPA AQI (2024 PM2.5 breakpoints).
 * Pure functions only – no I/O – so they are trivial to test.
 */

/** US EPA PM2.5 (24h, µg/m³) → AQI breakpoints, revised February 2024. */
const PM25_BREAKPOINTS = Object.freeze([
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500 },
]);

/** AQI categories, ordered from best to worst. `index` is used by the decision engine. */
export const AQI_LEVELS = Object.freeze([
  { id: 'good', max: 50, label: 'Good' },
  { id: 'moderate', max: 100, label: 'Moderate' },
  { id: 'usg', max: 150, label: 'Unhealthy for Sensitive Groups' },
  { id: 'unhealthy', max: 200, label: 'Unhealthy' },
  { id: 'very_unhealthy', max: 300, label: 'Very Unhealthy' },
  { id: 'hazardous', max: Infinity, label: 'Hazardous' },
]);

/** Named indexes into AQI_LEVELS to keep decision rules readable. */
export const LEVEL = Object.freeze({
  GOOD: 0,
  MODERATE: 1,
  USG: 2,
  UNHEALTHY: 3,
  VERY_UNHEALTHY: 4,
  HAZARDOUS: 5,
});

/**
 * Map an AQI value to its category.
 * @param {number} aqi
 * @returns {{id: string, label: string, max: number, index: number}}
 */
export function categorizeAqi(aqi) {
  if (!Number.isFinite(aqi) || aqi < 0) {
    throw new RangeError(`AQI must be a non-negative number, received ${aqi}`);
  }
  const index = AQI_LEVELS.findIndex((level) => aqi <= level.max);
  return { ...AQI_LEVELS[index], index };
}

/**
 * Convert a PM2.5 concentration to a US AQI value.
 * @param {number | null | undefined} pm25 concentration in µg/m³
 * @returns {number | null} AQI (0–500) or null when input is unusable
 */
export function pm25ToAqi(pm25) {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  const c = Math.floor(pm25 * 10) / 10; // EPA truncates to one decimal
  const bp = PM25_BREAKPOINTS.find((b) => c <= b.cHigh);
  if (!bp) return 500;
  return Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.iLow);
}

/**
 * Berkeley Earth rule of thumb: breathing 22 µg/m³ of PM2.5 for 24 hours
 * is comparable to smoking one cigarette. Used to make exposure tangible.
 * @param {number} pm25
 * @returns {number} cigarettes per day, one decimal
 */
export function cigaretteEquivalent(pm25) {
  if (!Number.isFinite(pm25) || pm25 <= 0) return 0;
  return Math.round((pm25 / 22) * 10) / 10;
}
