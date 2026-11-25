import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { NotFoundError } from '../src/errors.js';
import { createApp } from '../src/server/app.js';
import { createRateLimiter } from '../src/server/rateLimiter.js';
import { loadStaticAssets } from '../src/server/static.js';
import { createAssistant } from '../src/services/assistant.js';
import { LOCATION, makeAir } from './fixtures.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const fakeAirService = {
  async lookup(location) {
    if (location.city === 'Atlantis') throw new NotFoundError('We couldn\'t find a place called "Atlantis".');
    if (location.city === 'Crash') throw new Error('unexpected');
    return { location: LOCATION, air: makeAir() };
  },
};

async function startServer({ rateMax = 100 } = {}) {
  const app = createApp({
    airService: fakeAirService,
    assistant: createAssistant({ apiKey: '' }),
    rateLimiter: createRateLimiter({ windowMs: 60_000, max: rateMax }),
    assets: await loadStaticAssets(publicDir),
    logger: { error() {} },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

const postJson = (base, route, body) =>
  fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('HTTP API', () => {
  let ctx;
  before(async () => { ctx = await startServer(); });
  after(() => ctx.server.close());

  it('reports health', async () => {
    const res = await fetch(`${ctx.base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('sets strict security headers on every response', async () => {
    const res = await fetch(`${ctx.base}/`);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('returns a full plan with a summary', async () => {
    const res = await postJson(ctx.base, '/api/plan', { city: 'Delhi', sensitivities: ['children'], commuteMode: 'car', commuteKm: 10 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.location.name, 'Delhi');
    assert.equal(data.plan.risk.category.id, 'unhealthy');
    assert.ok(data.plan.routine.length > 0);
    assert.ok(data.plan.indoor.length > 0);
    assert.ok(data.plan.alternatives.some((a) => a.impact));
    assert.equal(data.summary.source, 'rules');
  });

  it('answers follow-up questions', async () => {
    const res = await postJson(ctx.base, '/api/ask', { city: 'Delhi', question: 'Do I need a purifier?' });
    assert.equal(res.status, 200);
    assert.match((await res.json()).answer.text, /DIY|purifier/i);
  });

  it('serves air data via GET', async () => {
    const res = await fetch(`${ctx.base}/api/air?city=Delhi`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).air.current.aqi, 180);
  });

  it('validates input with helpful messages', async () => {
    const res = await postJson(ctx.base, '/api/plan', { city: '<b>', commuteMode: 'rocket' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.details.length, 2);
  });

  it('requires a question for /api/ask', async () => {
    const res = await postJson(ctx.base, '/api/ask', { city: 'Delhi' });
    assert.equal(res.status, 400);
  });

  it('rejects wrong content types, bad JSON and oversized bodies', async () => {
    const wrongType = await fetch(`${ctx.base}/api/plan`, { method: 'POST', body: 'city=Delhi', headers: { 'content-type': 'text/plain' } });
    assert.equal(wrongType.status, 415);
    const badJson = await fetch(`${ctx.base}/api/plan`, { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } });
    assert.equal(badJson.status, 400);
    const huge = await postJson(ctx.base, '/api/plan', { city: 'Delhi', pad: 'x'.repeat(20_000) });
    assert.equal(huge.status, 413);
  });

  it('maps unknown places to 404 and hides internal errors', async () => {
    assert.equal((await postJson(ctx.base, '/api/plan', { city: 'Atlantis' })).status, 404);
    const crash = await postJson(ctx.base, '/api/plan', { city: 'Crash' });
    assert.equal(crash.status, 500);
    assert.doesNotMatch(JSON.stringify(await crash.json()), /unexpected/);
  });

  it('returns 405 and 404 for unsupported routes', async () => {
    assert.equal((await fetch(`${ctx.base}/api/plan`)).status, 405);
    assert.equal((await fetch(`${ctx.base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${ctx.base}/`, { method: 'DELETE' })).status, 405);
  });

  it('serves static files compressed with caching validators', async () => {
    const res = await fetch(`${ctx.base}/`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /AirWise/);
    const etag = res.headers.get('etag');
    const revalidated = await fetch(`${ctx.base}/`, { headers: { 'if-none-match': etag } });
    assert.equal(revalidated.status, 304);
  });

  it('never serves files outside the public directory', async () => {
    for (const p of ['/../package.json', '/%2e%2e/server.js', '/src/config.js', '/.env']) {
      assert.equal((await fetch(`${ctx.base}${p}`)).status, 404, p);
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const { server, base } = await startServer({ rateMax: 2 });
    try {
      assert.equal((await fetch(`${base}/api/config`)).status, 200);
      assert.equal((await fetch(`${base}/api/config`)).status, 200);
      const limited = await fetch(`${base}/api/config`);
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal((await fetch(`${base}/api/health`)).status, 200, 'health is exempt');
    } finally {
      server.close();
    }
  });

  it('resets after the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => now });
    assert.equal(limiter.check('ip').allowed, true);
    assert.equal(limiter.check('ip').allowed, false);
    now = 1001;
    assert.equal(limiter.check('ip').allowed, true);
  });
});

describe('loadConfig', () => {
  it('applies safe defaults and validates values', () => {
    const config = loadConfig({ PORT: 'abc', GEMINI_MODEL: 'bad model/../', RATE_LIMIT_PER_MINUTE: '-5' });
    assert.equal(config.port, 8080);
    assert.equal(config.geminiModel, 'gemini-2.5-flash');
    assert.equal(config.rateLimit.max, 30);
    assert.equal(config.geminiApiKey, '');
  });

  it('reads provided values', () => {
    const config = loadConfig({ PORT: '3000', GEMINI_API_KEY: ' key ', GEMINI_MODEL: 'gemini-2.5-pro', TRUST_PROXY: 'true' });
    assert.equal(config.port, 3000);
    assert.equal(config.geminiApiKey, 'key');
    assert.equal(config.geminiModel, 'gemini-2.5-pro');
    assert.equal(config.trustProxy, true);
  });
});
