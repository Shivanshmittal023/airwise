/**
 * Deterministic text generation used when Gemini is not configured or fails.
 * Guarantees the assistant is always useful, even offline from the LLM.
 */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function topActions(plan, limit) {
  return [...plan.routine, ...plan.indoor]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, limit);
}

export function fallbackSummary({ location, plan }) {
  const { risk } = plan;
  const exposure = risk.cigarettes >= 0.5 ? `, about ${risk.cigarettes} cigarettes' worth of PM2.5 over a day` : '';
  const lines = [
    `${location.name} is at AQI ${risk.aqi} (${risk.category.label})${exposure}. Your household's risk today: ${risk.personal.label}.`,
    '',
    'Top actions:',
    ...topActions(plan, 3).map((item) => `• ${item.title}. ${item.why}`),
  ];
  const bestSwitch = plan.alternatives.find((item) => item.impact);
  if (bestSwitch) lines.push('', `Biggest switch: ${bestSwitch.title}. ${bestSwitch.explanation}`);
  return lines.join('\n');
}

/** Keyword routing from a question to the most relevant plan item. */
const TOPICS = [
  { keywords: ['mask', 'n95', 'ffp2', 'respirator'], ids: ['mask'] },
  { keywords: ['purifier', 'filter', 'hepa', 'cadr'], ids: ['purifier'] },
  { keywords: ['exercise', 'run', 'jog', 'gym', 'workout', 'cycle ride', 'sport'], ids: ['exercise', 'best-window'] },
  { keywords: ['window', 'ventilat', 'fresh air', 'air out'], ids: ['ventilation'] },
  { keywords: ['child', 'kid', 'school', 'baby', 'play'], ids: ['children', 'best-window'] },
  { keywords: ['plant'], ids: ['plants'] },
  { keywords: ['cook', 'kitchen', 'stove', 'fry'], ids: ['cooking', 'cooking-gas', 'cooking-electric'] },
  { keywords: ['heat', 'warm', 'fireplace', 'wood', 'coal'], ids: ['heating-heat_pump', 'heating'] },
  { keywords: ['commute', 'car', 'drive', 'metro', 'bus', 'bike', 'travel', 'office'], ids: ['commute-metro', 'commute-car', 'commute-route', 'commute-transit', 'remote-days'] },
  { keywords: ['when', 'time', 'outside', 'walk', 'go out'], ids: ['best-window', 'avoid-window'] },
  { keywords: ['asthma', 'inhaler', 'heart', 'cough', 'symptom', 'breath'], ids: ['medication'] },
];

export function fallbackAnswer({ plan, question }) {
  const q = question.toLowerCase();
  const items = [...plan.routine, ...plan.indoor, ...plan.alternatives];
  for (const topic of TOPICS) {
    if (!topic.keywords.some((k) => q.includes(k))) continue;
    const item = topic.ids.map((id) => items.find((i) => i.id === id)).find(Boolean);
    if (item) return `${item.title}. ${item.detail} Why: ${item.why ?? item.explanation}`;
  }
  return `Today's AQI is ${plan.risk.aqi} (${plan.risk.category.label}). I can help with timing outdoor activities, masks, purifiers, ventilation, cooking, heating and low-emission commuting — try asking about one of those.`;
}
