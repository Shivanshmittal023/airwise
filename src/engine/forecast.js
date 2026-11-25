/**
 * Forecast analysis: find the cleanest (and dirtiest) daytime windows in the
 * next 24 hours so families can time school runs, errands and exercise.
 */
import { categorizeAqi } from './aqi.js';

const pad = (hour) => `${String(hour).padStart(2, '0')}:00`;

/**
 * @param {{time: string, aqi: number}[]} hourly local ISO times ("YYYY-MM-DDTHH:mm")
 * @param {string} currentTime local ISO time of the latest observation
 * @param {{windowHours?: number, dayStart?: number, dayEnd?: number, horizon?: number, count?: number}} [options]
 * @returns {{best: object[], worst: object | null}}
 */
export function findCleanWindows(
  hourly,
  currentTime,
  { windowHours = 2, dayStart = 6, dayEnd = 21, horizon = 24, count = 2 } = {},
) {
  if (!Array.isArray(hourly) || hourly.length === 0) return { best: [], worst: null };

  const nowKey = typeof currentTime === 'string' ? currentTime.slice(0, 13) : '';
  const today = nowKey.slice(0, 10);
  const upcoming = hourly.filter((h) => h.time.slice(0, 13) >= nowKey).slice(0, horizon);

  const windows = [];
  for (let i = 0; i + windowHours <= upcoming.length; i += 1) {
    const slice = upcoming.slice(i, i + windowHours);
    const date = slice[0].time.slice(0, 10);
    const hours = slice.map((h) => Number(h.time.slice(11, 13)));
    const sameDay = slice.every((h) => h.time.slice(0, 10) === date);
    const consecutive = hours.every((hour, j) => hour === hours[0] + j);
    const daytime = hours.every((hour) => hour >= dayStart && hour < dayEnd);
    if (!sameDay || !consecutive || !daytime) continue;

    const avgAqi = Math.round(slice.reduce((sum, h) => sum + h.aqi, 0) / slice.length);
    const day = date === today ? 'today' : 'tomorrow';
    windows.push({
      date,
      day,
      startHour: hours[0],
      start: pad(hours[0]),
      end: pad(hours.at(-1) + 1),
      avgAqi,
      label: categorizeAqi(avgAqi).label,
    });
  }

  if (windows.length === 0) return { best: [], worst: null };

  const sorted = [...windows].sort((a, b) => a.avgAqi - b.avgAqi || a.date.localeCompare(b.date) || a.startHour - b.startHour);
  const overlaps = (a, b) => a.date === b.date && Math.abs(a.startHour - b.startHour) < windowHours;

  const best = [];
  for (const window of sorted) {
    if (best.length === count) break;
    if (best.every((chosen) => !overlaps(chosen, window))) best.push(window);
  }

  return { best, worst: sorted.at(-1) };
}

/** Human-friendly label, e.g. "14:00–16:00" or "14:00–16:00 tomorrow". */
export function formatWindow(window) {
  return `${window.start}–${window.end}${window.day === 'tomorrow' ? ' tomorrow' : ''}`;
}
