import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFetch, SafeFetchError } from '../../packages/validation/src/fetcher.js';
import { DEFAULT_SSRF_POLICY } from '../../packages/validation/src/ssrf.js';
import { validateUrl } from '../../packages/validation/src/validate-url.js';

/**
 * Real sockets, real redirects. The local test server lives on 127.0.0.1, so
 * the "dev" policy below opens loopback only - exactly what
 * ALLOW_PRIVATE_NETWORK_FETCH does - which lets us prove that redirect targets
 * are still revalidated and that metadata/link-local stay closed regardless.
 */
const devPolicy = { ...DEFAULT_SSRF_POLICY, allowPrivateNetwork: true };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /private/\n');
      return;
    }
    if (path === '/ok') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<html><head><title>OK</title><link rel="canonical" href="/ok"></head><body>hi</body></html>',
      );
      return;
    }
    if (path === '/noindex') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head><meta name="robots" content="noindex"></head></html>');
      return;
    }
    if (path === '/private/page') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head></head></html>');
      return;
    }
    if (path === '/missing') {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('not found');
      return;
    }
    if (path === '/redirect-ok') {
      response.writeHead(301, { location: '/ok' });
      response.end();
      return;
    }
    if (path === '/redirect-metadata') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
      return;
    }
    if (path === '/redirect-file') {
      response.writeHead(302, { location: 'file:///etc/passwd' });
      response.end();
      return;
    }
    if (path === '/redirect-redis') {
      response.writeHead(302, { location: 'http://127.0.0.1:6379/' });
      response.end();
      return;
    }
    if (path === '/redirect-internal-host') {
      response.writeHead(302, { location: 'http://metadata.google.internal/computeMetadata/v1/' });
      response.end();
      return;
    }
    if (path === '/loop') {
      response.writeHead(302, { location: '/loop' });
      response.end();
      return;
    }
    if (path === '/huge') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = Buffer.alloc(64 * 1024, 97);
      let sent = 0;
      const pump = (): void => {
        while (sent < 5 * 1024 * 1024) {
          sent += chunk.length;
          if (!response.write(chunk)) {
            response.once('drain', pump);
            return;
          }
        }
        response.end();
      };
      response.on('error', () => undefined);
      pump();
      return;
    }
    if (path === '/hang') {
      // Never answers.
      return;
    }
    response.writeHead(500);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('safeFetch with the production policy', () => {
  it('refuses loopback addresses outright', async () => {
    await expect(safeFetch(`${base}/ok`)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('refuses "localhost"', async () => {
    const port = (server.address() as AddressInfo).port;
    await expect(safeFetch(`http://localhost:${port}/ok`)).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('refuses the metadata endpoint', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });
});

describe('safeFetch redirect revalidation (dev policy, loopback open)', () => {
  it('follows a redirect to a permitted target', async () => {
    const result = await safeFetch(`${base}/redirect-ok`, { policy: devPolicy });
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe(`${base}/ok`);
    expect(result.redirects).toHaveLength(1);
  });

  it('blocks a redirect into cloud metadata even when private networks are open', async () => {
    const error = await safeFetch(`${base}/redirect-metadata`, { policy: devPolicy }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(SafeFetchError);
    expect((error as SafeFetchError).code).toBe('SSRF_BLOCKED');
  });

  it('blocks a redirect to a metadata hostname', async () => {
    await expect(
      safeFetch(`${base}/redirect-internal-host`, { policy: devPolicy }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('blocks a redirect to a non-http protocol', async () => {
    await expect(safeFetch(`${base}/redirect-file`, { policy: devPolicy })).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('blocks a redirect to an infrastructure port (Redis)', async () => {
    await expect(safeFetch(`${base}/redirect-redis`, { policy: devPolicy })).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('stops redirect loops', async () => {
    await expect(
      safeFetch(`${base}/loop`, { policy: devPolicy, maxRedirects: 3 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
  });
});

describe('safeFetch resource limits', () => {
  it('caps the response body instead of buffering it all', async () => {
    const result = await safeFetch(`${base}/huge`, { policy: devPolicy, maxBodyBytes: 100_000 });
    expect(result.truncated).toBe(true);
    expect(result.bodyBytes).toBe(100_000);
  });

  it('times out a server that never answers', async () => {
    await expect(
      safeFetch(`${base}/hang`, { policy: devPolicy, timeoutMs: 800 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('validateUrl end to end', () => {
  it('marks a reachable, crawlable page as VALID with diagnostics', async () => {
    const outcome = await validateUrl(`${base}/ok`, { policy: devPolicy });
    expect(outcome.verdict).toBe('VALID');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.robotsAllowed).toBe(true);
    expect(outcome.noindexDetected).toBe(false);
    expect(outcome.canonicalUrl).toBe(`${base}/ok`);
    expect(outcome.title).toBe('OK');
  });

  it('keeps a noindex page VALID but warns about it', async () => {
    const outcome = await validateUrl(`${base}/noindex`, { policy: devPolicy });
    expect(outcome.verdict).toBe('VALID');
    expect(outcome.noindexDetected).toBe(true);
    expect(outcome.warnings.some((warning) => /noindex/i.test(warning))).toBe(true);
  });

  it('blocks a page disallowed by robots.txt', async () => {
    const outcome = await validateUrl(`${base}/private/page`, { policy: devPolicy });
    expect(outcome.verdict).toBe('BLOCKED');
    expect(outcome.errorCode).toBe('ROBOTS_DISALLOWED');
  });

  it('marks an HTTP error as INVALID', async () => {
    const outcome = await validateUrl(`${base}/missing`, { policy: devPolicy });
    expect(outcome.verdict).toBe('INVALID');
    expect(outcome.errorCode).toBe('HTTP_404');
  });

  it('reports an SSRF refusal as BLOCKED under the production policy', async () => {
    const outcome = await validateUrl(`${base}/ok`);
    expect(outcome.verdict).toBe('BLOCKED');
    expect(outcome.errorCode).toBe('SSRF_BLOCKED');
  });

  it('records redirects as a warning', async () => {
    const outcome = await validateUrl(`${base}/redirect-ok`, { policy: devPolicy });
    expect(outcome.verdict).toBe('VALID');
    expect(outcome.redirectCount).toBe(1);
    expect(outcome.warnings.some((warning) => /Redirects/.test(warning))).toBe(true);
  });
});
