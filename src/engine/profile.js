/**
 * Validation and normalisation of user-supplied household profiles.
 * Everything coming from the network is untrusted: we whitelist enums,
 * bound numbers and strip control characters from free text.
 */
import { COMMUTE_FACTORS, COOKING_FACTORS, HEATING_FACTORS } from './impact.js';

export const SENSITIVITIES = Object.freeze(['children', 'elderly', 'respiratory', 'cardiac', 'pregnancy']);
export const COMMUTE_MODES = Object.freeze(Object.keys(COMMUTE_FACTORS));
export const HEATING_TYPES = Object.freeze(Object.keys(HEATING_FACTORS));
export const COOKING_FUELS = Object.freeze(Object.keys(COOKING_FACTORS));

export const LIMITS = Object.freeze({
  cityMaxLength: 80,
  questionMaxLength: 500,
  commuteKmMax: 200,
});

const CITY_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’()-]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isBlank = (value) => value === undefined || value === null || value === '';
const round = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Remove control characters, collapse whitespace and trim. */
export function sanitizeText(value) {
  return String(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Accept numbers or numeric strings (query params); return null otherwise. */
export function toFiniteNumber(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Parse either `{city}` or `{latitude, longitude}`.
 * Coordinates are rounded to 2 decimals (~1 km) to protect user privacy.
 * @param {Record<string, unknown>} input
 * @param {string[]} errors collector
 */
export function parseLocation(input, errors) {
  if (!isBlank(input.city)) {
    if (typeof input.city !== 'string') {
      errors.push('city must be text.');
      return null;
    }
    const city = sanitizeText(input.city);
    if (city.length < 2 || city.length > LIMITS.cityMaxLength || !CITY_PATTERN.test(city)) {
      errors.push(`city must be 2–${LIMITS.cityMaxLength} characters (letters, numbers, spaces, . , ' - ).`);
      return null;
    }
    return { city };
  }

  if (!isBlank(input.latitude) || !isBlank(input.longitude)) {
    const latitude = toFiniteNumber(input.latitude);
    const longitude = toFiniteNumber(input.longitude);
    const latOk = latitude !== null && latitude >= -90 && latitude <= 90;
    const lonOk = longitude !== null && longitude >= -180 && longitude <= 180;
    if (!latOk) errors.push('latitude must be a number between -90 and 90.');
    if (!lonOk) errors.push('longitude must be a number between -180 and 180.');
    return latOk && lonOk ? { latitude: round(latitude, 2), longitude: round(longitude, 2) } : null;
  }

  errors.push('Provide a city name or share your location.');
  return null;
}

function parseEnum(value, allowed, field, fallback, errors) {
  if (isBlank(value)) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(`${field} must be one of: ${allowed.join(', ')}.`);
    return fallback;
  }
  return value;
}

function parseBoolean(value, field, errors) {
  if (isBlank(value)) return false;
  if (typeof value !== 'boolean') {
    errors.push(`${field} must be true or false.`);
    return false;
  }
  return value;
}

function parseSensitivities(value, errors) {
  if (isBlank(value)) return [];
  if (!Array.isArray(value) || value.some((item) => !SENSITIVITIES.includes(item))) {
    errors.push(`sensitivities must be a list containing only: ${SENSITIVITIES.join(', ')}.`);
    return [];
  }
  return [...new Set(value)];
}

function parseCommuteKm(value, errors) {
  if (isBlank(value)) return 0;
  const km = toFiniteNumber(value);
  if (km === null || km < 0 || km > LIMITS.commuteKmMax) {
    errors.push(`commuteKm must be a number between 0 and ${LIMITS.commuteKmMax}.`);
    return 0;
  }
  return round(km, 1);
}

function parseQuestion(value, required, errors) {
  if (isBlank(value)) {
    if (required) errors.push('question is required.');
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push('question must be text.');
    return undefined;
  }
  const question = sanitizeText(value);
  if (question.length > LIMITS.questionMaxLength) {
    errors.push(`question must be at most ${LIMITS.questionMaxLength} characters.`);
    return undefined;
  }
  if (required && question.length < 3) errors.push('question is too short.');
  return question || undefined;
}

/**
 * Validate a household profile.
 * @param {unknown} input parsed JSON body
 * @param {{requireQuestion?: boolean}} [options]
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateProfile(input, { requireQuestion = false } = {}) {
  if (!isPlainObject(input)) return { ok: false, errors: ['Request body must be a JSON object.'] };

  const errors = [];
  const location = parseLocation(input, errors);
  const commuteMode = parseEnum(input.commuteMode, COMMUTE_MODES, 'commuteMode', 'remote', errors);
  const commuteKm = parseCommuteKm(input.commuteKm, errors);

  const value = {
    location,
    sensitivities: parseSensitivities(input.sensitivities, errors),
    commuteMode,
    commuteKm: commuteMode === 'remote' ? 0 : commuteKm,
    heating: parseEnum(input.heating, HEATING_TYPES, 'heating', 'none', errors),
    cooking: parseEnum(input.cooking, COOKING_FUELS, 'cooking', 'gas', errors),
    hasPurifier: parseBoolean(input.hasPurifier, 'hasPurifier', errors),
    exercisesOutdoors: parseBoolean(input.exercisesOutdoors, 'exercisesOutdoors', errors),
    question: parseQuestion(input.question, requireQuestion, errors),
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
