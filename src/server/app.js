/**
 * Request handler: routing, validation and error mapping.
 * Dependencies are injected so the whole app can be tested without network access.
 */
import { buildPlan } from '../engine/recommendations.js';
import { parseLocation, validateProfile } from '../engine/profile.js';
import { HttpError, ValidationError } from '../errors.js';
import { applySecurityHeaders, clientId, readJsonBody, sendJson } from './http.js';
import { serveAsset } from './static.js';

function parseProfileOrThrow(body, options) {
  const result = validateProfile(body, options);
  if (!result.ok) throw new ValidationError(result.errors);
  return result.value;
}

/**
 * @param {{
 *   airService: {lookup: Function},
 *   assistant: {enabled: boolean, summarize: Function, answer: Function},
 *   rateLimiter: {check: Function},
 *   assets: Map<string, object>,
 *   trustProxy?: boolean,
 *   maxBodyBytes?: number,
 *   logger?: Pick<Console, 'error'>,
 * }} deps
 */
export function createApp({ airService, assistant, rateLimiter, assets, trustProxy = false, maxBodyBytes = 10 * 1024, logger = console }) {
  const routes = {
    'GET /api/health': async () => ({ status: 'ok' }),

    'GET /api/config': async () => ({ aiEnabled: assistant.enabled }),

    'GET /api/air': async ({ url }) => {
      const errors = [];
      const location = parseLocation(Object.fromEntries(url.searchParams), errors);
      if (!location) throw new ValidationError(errors);
      return airService.lookup(location);
    },

    'POST /api/plan': async ({ req }) => {
      const profile = parseProfileOrThrow(await readJsonBody(req, maxBodyBytes));
      const { location, air } = await airService.lookup(profile.location);
      const plan = buildPlan(air, profile);
      const summary = await assistant.summarize({ location, air, plan, profile });
      return { location, air, plan, summary };
    },

    'POST /api/ask': async ({ req }) => {
      const profile = parseProfileOrThrow(await readJsonBody(req, maxBodyBytes), { requireQuestion: true });
      const { location, air } = await airService.lookup(profile.location);
      const plan = buildPlan(air, profile);
      const answer = await assistant.answer({ location, air, plan, profile, question: profile.question });
      return { answer };
    },
  };

  const knownApiPaths = new Set(Object.keys(routes).map((key) => key.split(' ')[1]));

  async function handleApi(req, res, url) {
    if (url.pathname !== '/api/health') {
      const limit = rateLimiter.check(clientId(req, trustProxy));
      res.setHeader('RateLimit-Remaining', String(limit.remaining));
      if (!limit.allowed) {
        sendJson(res, 429, { error: 'Too many requests. Please wait a minute and try again.' }, { 'Retry-After': String(limit.retryAfterSec) });
        return;
      }
    }

    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) {
      if (knownApiPaths.has(url.pathname)) throw new HttpError(405, 'Method not allowed.');
      throw new HttpError(404, 'Not found.');
    }
    sendJson(res, 200, await route({ req, url }));
  }

  function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    const asset = assets.get(url.pathname);
    if (!asset) throw new HttpError(404, 'Not found.');
    serveAsset(req, res, asset);
  }

  return async function handle(req, res) {
    applySecurityHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else handleStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, ...(error.details ? { details: error.details } : {}) });
        return;
      }
      logger.error('[server] Unexpected error:', error);
      sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    }
  };
}
