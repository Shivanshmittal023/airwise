/**
 * Static assets are loaded and pre-compressed once at start-up.
 * Serving only from this whitelist map makes path traversal impossible
 * and avoids any disk I/O per request.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.webmanifest', '.txt']);
/**
 * Code and markup must always revalidate: after a deploy, a browser that mixes
 * new HTML with stale cached CSS/JS renders a broken page. ETags make the
 * revalidation a cheap 304. Only images may be cached for a day.
 */
const ALWAYS_REVALIDATE = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.txt']);

/** @param {string} rootDir */
export async function loadStaticAssets(rootDir) {
  const assets = new Map();
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const type = MIME_TYPES[ext];
    if (!type) continue;

    const absolute = path.join(entry.parentPath ?? entry.path, entry.name);
    const body = await readFile(absolute);
    const gzip = COMPRESSIBLE.has(ext) ? gzipSync(body) : null;
    const urlPath = `/${path.relative(rootDir, absolute).split(path.sep).join('/')}`;

    assets.set(urlPath, {
      body,
      gzip: gzip && gzip.length < body.length ? gzip : null,
      type,
      etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      cacheControl: ALWAYS_REVALIDATE.has(ext) ? 'no-cache' : 'public, max-age=86400',
    });
  }

  if (assets.has('/index.html')) assets.set('/', assets.get('/index.html'));
  return assets;
}

/** Write an asset, honouring ETag revalidation and gzip negotiation. */
export function serveAsset(req, res, asset) {
  res.setHeader('Content-Type', asset.type);
  res.setHeader('ETag', asset.etag);
  res.setHeader('Cache-Control', asset.cacheControl);
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.headers['if-none-match'] === asset.etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const useGzip = asset.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const body = useGzip ? asset.gzip : asset.body;
  if (useGzip) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', body.length);
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? undefined : body);
}
