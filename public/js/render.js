/**
 * DOM rendering. All dynamic content is inserted with textContent – never
 * innerHTML – so API or model output can't inject markup (XSS-safe).
 */
import {
  PRIORITY_TEXT,
  describeForecast,
  formatLocalTime,
  gaugeOffset,
  iconForItem,
  impactChips,
  levelIdForAqi,
  placeLabel,
  upcomingHours,
} from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AQI_GUIDES = [50, 100, 150, 200, 300];

/** Create an element with optional class, text, attributes and children. */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Decorative icon from the inline sprite. */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const byId = (id) => document.getElementById(id);

function sensitiveNote(risk) {
  if (risk.sensitiveGroups.length === 0) return 'No sensitive groups selected: advice is for healthy adults.';
  if (risk.personal.index > risk.category.index) return `Risk raised one level for ${risk.sensitiveGroups.join(', ')}.`;
  return `Includes ${risk.sensitiveGroups.join(', ')}: we'll flag extra precautions.`;
}

export function renderOverview({ location, air, plan }) {
  const levelClass = `level-${plan.risk.category.id}`;
  byId('place-name').textContent = placeLabel(location);
  byId('observed').textContent = `Updated ${formatLocalTime(air.current.time)} local time (${air.timezone}) · ${air.source}`;

  byId('gauge').className = `gauge ${levelClass}`;
  byId('gauge-fill').setAttribute('stroke-dashoffset', String(gaugeOffset(air.current.aqi)));
  byId('aqi-value').textContent = air.current.aqi;

  const pill = byId('aqi-category');
  pill.className = `level-pill ${levelClass}`;
  pill.textContent = plan.risk.category.label;
  byId('personal-risk').textContent = plan.risk.personal.label;

  const pollutants = [
    ['PM2.5', air.current.pm25],
    ['PM10', air.current.pm10],
    ['NO₂', air.current.no2],
    ['O₃', air.current.o3],
  ].filter(([, value]) => value !== null && value !== undefined);

  byId('pollutants').replaceChildren(
    ...pollutants.map(([name, value]) => el('div', {}, [
      el('dt', { text: name }),
      el('dd', { text: `${value} ` }, [el('small', { text: 'µg/m³' })]),
    ])),
  );

  byId('cig-value').textContent = plan.risk.cigarettes ?? '—';
  byId('who-value').textContent = plan.risk.whoMultiple === null ? '—' : `${plan.risk.whoMultiple}×`;
  byId('risk-note').textContent = sensitiveNote(plan.risk);
}

export function renderForecast(air, windows) {
  const hours = upcomingHours(air);
  const chart = byId('forecast-chart');
  const rows = byId('forecast-rows');

  if (hours.length === 0) {
    chart.replaceChildren(el('p', { className: 'muted', text: 'No forecast available.' }));
    chart.setAttribute('aria-label', 'No forecast available.');
    rows.replaceChildren();
    return;
  }

  const clean = new Set();
  for (const w of windows.best) {
    for (let h = w.startHour; h < Number(w.end.slice(0, 2)); h += 1) clean.add(`${w.date}T${String(h).padStart(2, '0')}`);
  }
  const maxAqi = Math.max(150, ...hours.map((h) => h.aqi)) * 1.08;
  const pct = (value) => `${Math.min(100, (value / maxAqi) * 100)}%`;

  const guides = AQI_GUIDES.filter((v) => v < maxAqi).map((value) => {
    const guide = el('div', { className: 'guide', attrs: { 'aria-hidden': 'true' } }, [el('span', { className: 'guide-label', text: value })]);
    guide.style.bottom = `calc(26px + (100% - 50px) * ${value / maxAqi})`;
    return guide;
  });

  const bars = hours.map((h, i) => {
    const classes = ['bar', `level-${levelIdForAqi(h.aqi)}`];
    if (clean.has(h.time.slice(0, 13))) classes.push('clean');
    if (i === 0) classes.push('now');
    const bar = el('div', { className: classes.join(' '), attrs: { title: `${h.time.slice(11, 16)} · AQI ${h.aqi}` } });
    bar.style.height = pct(h.aqi);
    bar.style.animationDelay = `${i * 18}ms`;
    if (i % 3 === 0) bar.append(el('span', { className: 'bar-label', text: h.time.slice(11, 16), attrs: { 'aria-hidden': 'true' } }));
    return bar;
  });

  chart.replaceChildren(...guides, ...bars);
  chart.setAttribute('aria-label', describeForecast(hours, windows.best[0]));

  rows.replaceChildren(
    ...hours.map((h) => el('tr', {}, [
      el('td', { text: formatLocalTime(h.time) }),
      el('td', { text: h.aqi }),
      el('td', { text: h.pm25 ?? '—' }),
    ])),
  );
}

function renderImpactChips(impact) {
  const chips = impactChips(impact);
  if (chips.length === 0) return null;
  return el('ul', { className: 'impact', attrs: { 'aria-label': 'Estimated impact' } }, chips.map((text) => el('li', { text })));
}

/** Render a list of plan items (routine, indoor hacks or alternatives). */
export function renderPlanList(listId, items) {
  byId(`${listId}-count`).textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  byId(listId).replaceChildren(
    ...items.map((item) => el('li', { className: `plan-item priority-${item.priority}` }, [
      el('span', { className: 'item-icon' }, [icon(iconForItem(item))]),
      el('div', { className: 'item-body' }, [
        el('span', { className: 'priority-tag', text: PRIORITY_TEXT[item.priority] }),
        el('h4', { text: item.title }),
        el('p', { text: item.detail }),
        renderImpactChips(item.impact),
        el('p', { className: 'why' }, [el('strong', { text: 'Why it matters: ' }), document.createTextNode(item.why ?? item.explanation)]),
      ]),
    ])),
  );
}

export function renderImpactSummary(summary) {
  const banner = byId('impact-banner');
  if (!summary || (summary.co2KgPerMonth <= 0 && summary.pm25GPerMonth <= 0)) {
    banner.hidden = true;
    return;
  }
  const parts = [];
  if (summary.co2KgPerMonth > 0) parts.push(el('strong', { text: `${summary.co2KgPerMonth} kg of CO₂` }));
  if (summary.pm25GPerMonth > 0) parts.push(el('strong', { text: `${summary.pm25GPerMonth} g of PM2.5` }));

  const text = byId('impact-text');
  text.replaceChildren(document.createTextNode(`Making your top ${summary.switches === 1 ? 'switch' : `${summary.switches} switches`} could avoid `));
  parts.forEach((part, i) => {
    if (i > 0) text.append(document.createTextNode(' and '));
    text.append(part);
  });
  text.append(document.createTextNode(' every month'));
  if (summary.treesEquivalent >= 1) text.append(document.createTextNode(`, the yearly CO₂ uptake of about ${summary.treesEquivalent} trees`));
  text.append(document.createTextNode('.'));
  banner.hidden = false;
}

export function renderSummary(summary) {
  byId('summary').textContent = summary.text;
  const badge = byId('summary-source');
  badge.replaceChildren(
    icon(summary.source === 'gemini' ? 'sparkle' : 'check', 'icon icon-sm'),
    document.createTextNode(summary.source === 'gemini' ? 'Written by Google Gemini' : 'Generated by AirWise rules'),
  );
}
