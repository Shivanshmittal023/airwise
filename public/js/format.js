/**
 * Pure presentation helpers (no DOM access), shared by the renderer and
 * unit-tested directly with node:test.
 */

export const PRIORITY_TEXT = Object.freeze({ high: 'High priority', medium: 'Recommended', low: 'Good to know' });

const LEVEL_THRESHOLDS = Object.freeze([
  [50, 'good'],
  [100, 'moderate'],
  [150, 'usg'],
  [200, 'unhealthy'],
  [300, 'very_unhealthy'],
]);

/** AQI value → CSS level id (matches the engine's category ids). */
export function levelIdForAqi(aqi) {
  const match = LEVEL_THRESHOLDS.find(([max]) => aqi <= max);
  return match ? match[1] : 'hazardous';
}

/** Gauge arc offset in % of path length (0 = full, 100 = empty). AQI 300+ fills the gauge. */
export function gaugeOffset(aqi) {
  const clamped = Math.min(Math.max(Number(aqi) || 0, 0), 300);
  return Math.round((100 - (clamped / 300) * 100) * 10) / 10;
}

export function placeLabel(location) {
  return [location.name, location.region, location.country].filter(Boolean).join(', ');
}

/** Short, scannable impact chips, e.g. "−61.6 kg CO₂/mo". */
export function impactChips(impact) {
  if (!impact) return [];
  const chips = [];
  if (impact.co2KgPerMonth > 0) chips.push(`−${impact.co2KgPerMonth} kg CO₂/mo`);
  if (impact.co2KgPerMonth < 0) chips.push(`+${-impact.co2KgPerMonth} kg CO₂/mo`);
  if (impact.pm25GPerMonth > 0) chips.push(`−${impact.pm25GPerMonth} g PM2.5/mo`);
  if (impact.treesEquivalent >= 1) chips.push(`≈ ${impact.treesEquivalent} trees/yr`);
  return chips;
}

const ICON_BY_ID = Object.freeze({
  'best-window': 'clock',
  'avoid-window': 'alert',
  exercise: 'activity',
  'commute-car': 'navigation',
  'commute-route': 'navigation',
  'commute-transit': 'navigation',
  mask: 'shield',
  children: 'heart',
  medication: 'heart',
  'stay-indoors': 'home',
  ventilation: 'wind',
  purifier: 'filter',
  cooking: 'flame',
  heating: 'thermometer',
  'indoor-sources': 'ban',
  'wet-cleaning': 'droplet',
  'seal-gaps': 'home',
  plants: 'leaf',
});

const ICON_BY_CATEGORY = Object.freeze({
  commute: 'navigation',
  heating: 'thermometer',
  cooking: 'flame',
  driving: 'zap',
  community: 'users',
});

/** Pick an icon symbol id for a plan item. */
export function iconForItem(item) {
  return ICON_BY_ID[item.id] ?? ICON_BY_CATEGORY[item.category] ?? 'check';
}

/** "2026-11-25T09:00" → "25 Nov, 09:00". */
export function formatLocalTime(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(iso));
  if (!match) return String(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]}, ${match[4]}`;
}

/** Hours from the current observation onwards (max 24). */
export function upcomingHours(air, horizon = 24) {
  const nowKey = air.current.time.slice(0, 13);
  return air.hourly.filter((h) => h.time.slice(0, 13) >= nowKey).slice(0, horizon);
}

/** Accessible one-sentence description of the forecast chart. */
export function describeForecast(hours, best) {
  if (hours.length === 0) return 'No forecast available.';
  const min = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a));
  const max = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const window = best ? ` Cleanest daytime window: ${best.start} to ${best.end} ${best.day}.` : '';
  return `Forecast US AQI for the next ${hours.length} hours ranges from ${min.aqi} at ${min.time.slice(11, 16)} to ${max.aqi} at ${max.time.slice(11, 16)}.${window}`;
}
