/** Shared test fixtures. */

/** Build an hourly series for a given date starting at 00:00 from an array of AQI values. */
export function hourlySeries(date, aqis) {
  return aqis.map((aqi, hour) => ({
    time: `${date}T${String(hour).padStart(2, '0')}:00`,
    aqi,
    pm25: aqi / 4,
  }));
}

/** A smoggy winter day: bad mornings/evenings, cleaner afternoon. */
export const SMOGGY_DAY = [
  260, 270, 280, 290, 300, 310, 320, 330, 310, 280, 240, 200,
  170, 150, 140, 145, 170, 220, 280, 320, 340, 330, 310, 290,
];

export function makeAir({ aqi = 180, pm25 = 110, time = '2026-11-25T08:00', hourly } = {}) {
  return {
    current: { time, aqi, pm25, pm10: 200, no2: 60, o3: 20, co: 900 },
    hourly: hourly ?? [...hourlySeries('2026-11-25', SMOGGY_DAY), ...hourlySeries('2026-11-26', SMOGGY_DAY)],
    timezone: 'Asia/Kolkata',
    source: 'test',
  };
}

export function makeProfile(overrides = {}) {
  return {
    location: { city: 'Delhi' },
    sensitivities: [],
    commuteMode: 'remote',
    commuteKm: 0,
    heating: 'none',
    cooking: 'gas',
    hasPurifier: false,
    exercisesOutdoors: false,
    ...overrides,
  };
}

export const LOCATION = { name: 'Delhi', region: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.23 };

/** Minimal fetch Response stand-in. */
export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Raw Open-Meteo air-quality payload. */
export function openMeteoAirPayload({ aqi = 180, pm25 = 110 } = {}) {
  const times = hourlySeries('2026-11-25', SMOGGY_DAY).map((h) => h.time);
  return {
    timezone: 'Asia/Kolkata',
    current: {
      time: '2026-11-25T08:00',
      us_aqi: aqi,
      pm2_5: pm25,
      pm10: 210.4,
      nitrogen_dioxide: 55.1,
      ozone: 12.3,
      carbon_monoxide: 950,
    },
    hourly: { time: times, us_aqi: SMOGGY_DAY, pm2_5: SMOGGY_DAY.map((a) => a / 4) },
  };
}
