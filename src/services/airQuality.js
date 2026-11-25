/**
 * Live air-quality data from Open-Meteo (CAMS model, global coverage, no API key).
 * https://open-meteo.com/en/docs/air-quality-api
 */
import { pm25ToAqi } from '../engine/aqi.js';
import { NotFoundError, UpstreamError } from '../errors.js';
import { TtlCache } from './cache.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const CURRENT_FIELDS = 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide';
const HOURLY_FIELDS = 'us_aqi,pm2_5';

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/** Normalise Open-Meteo's response into the shape used by the engine. */
export function normalizeAirQuality(raw) {
  const current = raw?.current ?? {};
  const pm25 = toNumber(current.pm2_5);
  const aqi = toNumber(current.us_aqi) ?? pm25ToAqi(pm25);
  if (aqi === null || typeof current.time !== 'string') {
    throw new UpstreamError('Air-quality data is not available for this location right now.');
  }

  const times = Array.isArray(raw.hourly?.time) ? raw.hourly.time : [];
  const hourly = times
    .map((time, i) => {
      const hourPm25 = toNumber(raw.hourly.pm2_5?.[i]);
      return { time, aqi: toNumber(raw.hourly.us_aqi?.[i]) ?? pm25ToAqi(hourPm25), pm25: round1(hourPm25) };
    })
    .filter((h) => typeof h.time === 'string' && h.aqi !== null);

  return {
    current: {
      time: current.time,
      aqi: Math.round(aqi),
      pm25: round1(pm25),
      pm10: round1(toNumber(current.pm10)),
      no2: round1(toNumber(current.nitrogen_dioxide)),
      o3: round1(toNumber(current.ozone)),
      co: round1(toNumber(current.carbon_monoxide)),
    },
    hourly,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'UTC',
    source: 'Open-Meteo Air Quality API (Copernicus CAMS)',
  };
}

/**
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, cacheTtlMs?: number, now?: () => number}} [options]
 */
export function createAirService({ fetchImpl = globalThis.fetch, timeoutMs = 8000, cacheTtlMs = 10 * 60 * 1000, now } = {}) {
  const geoCache = new TtlCache({ ttlMs: 24 * 60 * 60 * 1000, maxEntries: 1000, now });
  const airCache = new TtlCache({ ttlMs: cacheTtlMs, maxEntries: 500, now });

  async function getJson(url) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new UpstreamError();
    }
    if (!response.ok) throw new UpstreamError();
    try {
      return await response.json();
    } catch {
      throw new UpstreamError();
    }
  }

  /** @param {string} city */
  function geocode(city) {
    return geoCache.getOrCreate(city.toLowerCase(), async () => {
      const url = new URL(GEOCODING_URL);
      url.search = new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' }).toString();
      const data = await getJson(url);
      const place = data?.results?.[0];
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        throw new NotFoundError(`We couldn't find a place called "${city}". Try a nearby larger city.`);
      }
      return {
        name: place.name,
        region: place.admin1 ?? null,
        country: place.country ?? null,
        latitude: place.latitude,
        longitude: place.longitude,
      };
    });
  }

  /** @param {{latitude: number, longitude: number}} coords */
  function getAirQuality({ latitude, longitude }) {
    const lat = latitude.toFixed(2);
    const lon = longitude.toFixed(2);
    return airCache.getOrCreate(`${lat},${lon}`, async () => {
      const url = new URL(AIR_QUALITY_URL);
      url.search = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: CURRENT_FIELDS,
        hourly: HOURLY_FIELDS,
        forecast_days: '2',
        timezone: 'auto',
      }).toString();
      return normalizeAirQuality(await getJson(url));
    });
  }

  /**
   * Resolve a validated location (city or coordinates) to place + air data.
   * @param {{city: string} | {latitude: number, longitude: number}} location
   */
  async function lookup(location) {
    const place = 'city' in location
      ? await geocode(location.city)
      : { name: 'Your location', region: null, country: null, ...location };
    const air = await getAirQuality(place);
    return { location: place, air };
  }

  return { geocode, getAirQuality, lookup };
}
