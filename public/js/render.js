/**
 * DOM rendering. All dynamic content is inserted with textContent – never
 * innerHTML – so API or model output can't inject markup (XSS-safe).
 */

const PRIORITY_TEXT = { high: 'High priority', medium: 'Recommended', low: 'Good to know' };

/** Create an element with optional class, text, attributes and children. */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

const byId = (id) => document.getElementById(id);
const levelClass = (id) => `level-${id}`;

function levelIdForAqi(aqi) {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'usg';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

function placeLabel(location) {
  return [location.name, location.region, location.country].filter(Boolean).join(', ');
}

export function renderAir({ location, air, plan }) {
  byId('place-name').textContent = placeLabel(location);

  const badge = byId('aqi-badge');
  badge.className = `aqi-badge ${levelClass(plan.risk.category.id)}`;
  byId('aqi-value').textContent = air.current.aqi;
  byId('aqi-category').textContent = plan.risk.category.label;
  byId('personal-risk').textContent = `Personal risk for your household: ${plan.risk.personal.label}`;
  byId('risk-explanation').textContent = plan.risk.explanation;

  const pollutants = [
    ['PM2.5', air.current.pm25, 'µg/m³'],
    ['PM10', air.current.pm10, 'µg/m³'],
    ['NO₂', air.current.no2, 'µg/m³'],
    ['O₃', air.current.o3, 'µg/m³'],
  ].filter(([, value]) => value !== null && value !== undefined);

  byId('pollutants').replaceChildren(
    ...pollutants.map(([name, value, unit]) => el('div', {}, [el('dt', { text: name }), el('dd', { text: `${value} ${unit}` })])),
  );
  byId('observed').textContent = `Observed ${air.current.time.replace('T', ' ')} (${air.timezone}). Source: ${air.source}.`;
}

export function renderForecast(air, windows) {
  const nowKey = air.current.time.slice(0, 13);
  const hours = air.hourly.filter((h) => h.time.slice(0, 13) >= nowKey).slice(0, 24);
  const chart = byId('forecast-chart');

  if (hours.length === 0) {
    chart.replaceChildren(el('p', { text: 'No forecast available.' }));
    chart.removeAttribute('aria-label');
    byId('forecast-rows').replaceChildren();
    return;
  }

  const clean = new Set();
  for (const w of windows.best) {
    for (let h = w.startHour; h < Number(w.end.slice(0, 2)); h += 1) clean.add(`${w.date}T${String(h).padStart(2, '0')}`);
  }
  const maxAqi = Math.max(150, ...hours.map((h) => h.aqi));

  chart.replaceChildren(
    ...hours.map((h, i) => {
      const bar = el('div', { className: `bar ${levelClass(levelIdForAqi(h.aqi))}${clean.has(h.time.slice(0, 13)) ? ' clean' : ''}` });
      bar.style.height = `${Math.max(3, (h.aqi / maxAqi) * 100)}%`;
      if (i % 3 === 0) bar.append(el('span', { className: 'bar-label', text: h.time.slice(11, 16), attrs: { 'aria-hidden': 'true' } }));
      return bar;
    }),
  );

  const min = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a));
  const max = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const best = windows.best[0];
  chart.setAttribute(
    'aria-label',
    `Forecast US AQI for the next ${hours.length} hours ranges from ${min.aqi} at ${min.time.slice(11, 16)} to ${max.aqi} at ${max.time.slice(11, 16)}.` +
      (best ? ` Cleanest daytime window: ${best.start} to ${best.end} ${best.day}.` : ''),
  );

  byId('forecast-rows').replaceChildren(
    ...hours.map((h) => el('tr', {}, [
      el('td', { text: h.time.replace('T', ' ') }),
      el('td', { text: h.aqi }),
      el('td', { text: h.pm25 ?? '—' }),
    ])),
  );
}

function renderImpact(impact) {
  if (!impact) return null;
  const chips = [];
  if (impact.co2KgPerMonth !== 0) {
    chips.push(`${impact.co2KgPerMonth > 0 ? '−' : '+'}${Math.abs(impact.co2KgPerMonth)} kg CO₂ / month`);
  }
  if (impact.pm25GPerMonth > 0) chips.push(`−${impact.pm25GPerMonth} g PM2.5 / month`);
  if (impact.treesEquivalent >= 1) chips.push(`≈ ${impact.treesEquivalent} trees / year`);
  if (chips.length === 0) return null;
  return el('ul', { className: 'impact', attrs: { 'aria-label': 'Estimated impact' } }, chips.map((text) => el('li', { text })));
}

/** Render a list of plan items (routine, indoor hacks or alternatives). */
export function renderPlanList(listId, items) {
  byId(listId).replaceChildren(
    ...items.map((item) => el('li', { className: `plan-item priority-${item.priority}` }, [
      el('span', { className: 'priority-tag', text: PRIORITY_TEXT[item.priority] }),
      el('h4', { text: item.title }),
      el('p', { text: item.detail }),
      renderImpact(item.impact),
      el('p', { className: 'why', text: `Why: ${item.why ?? item.explanation}` }),
    ])),
  );
}

export function renderSummary(summary) {
  byId('summary').textContent = summary.text;
  byId('summary-source').textContent = summary.source === 'gemini'
    ? 'Written by Google Gemini from your plan data.'
    : 'Generated by AirWise rules (AI briefing unavailable).';
}
