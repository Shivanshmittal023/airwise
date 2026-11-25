/** Composition root: wire real dependencies and start the HTTP server. */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { createApp } from './src/server/app.js';
import { createRateLimiter } from './src/server/rateLimiter.js';
import { loadStaticAssets } from './src/server/static.js';
import { createAirService } from './src/services/airQuality.js';
import { createAssistant } from './src/services/assistant.js';

const config = loadConfig();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const app = createApp({
  airService: createAirService({ timeoutMs: config.upstreamTimeoutMs, cacheTtlMs: config.cacheTtlMs }),
  assistant: createAssistant({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.aiTimeoutMs }),
  rateLimiter: createRateLimiter(config.rateLimit),
  assets: await loadStaticAssets(publicDir),
  trustProxy: config.trustProxy,
  maxBodyBytes: config.maxBodyBytes,
});

const server = http.createServer(app);
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

server.listen(config.port, () => {
  const ai = config.geminiApiKey ? `Gemini (${config.geminiModel})` : 'rule-based fallback (no GEMINI_API_KEY)';
  console.log(`AirWise listening on http://localhost:${config.port} — assistant: ${ai}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
