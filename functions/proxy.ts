/**
 * GET|POST /proxy?url=<https address> — Path of Building's proxy, as a
 * Cloudflare Pages Function (Workers runtime). api/proxy.ts is the same proxy
 * for Vercel; keep the two in step while both hosts run.
 *
 * The application at /pob/ asks build sites (pobb.in, poe.ninja, ...) and the
 * Path of Exile site straight from the page. Many refuse requests from other
 * pages (CORS); then it asks again through `/proxy?url=` on its own host.
 * Without this it says the site cannot be reached; everything else works.
 *
 * The rules are the application's own, as in pob-rust-wasm's tools/serve.mjs
 * and HOSTING.md, and must stay in step with them:
 * - only https, only the hosts the application asks, no port, no user;
 * - nothing with POESESSID in the address, a passed header or the body;
 * - GET and POST; only Accept, Content-Type and Authorization go on, never
 *   cookies; no cookie comes back;
 * - the site's reply is marked `X-Pob-Proxy: site`, this function's own
 *   failures `X-Pob-Proxy: error` with a short text;
 * - 256 MiB and 300 s at most.
 *
 * Workers on the free plan get 10 ms of CPU per request; waiting on the
 * network is not counted. A reply with a declared length is handed on as the
 * runtime's own stream (no JS per chunk); only a reply of unknown length goes
 * through the counting stream, which costs CPU per chunk.
 *
 * _headers does not apply to Functions, so the headers the site needs are set
 * here. Every visitor's request leaves from Cloudflare's addresses, so a site
 * may rate-limit it.
 */

const ALLOWED_HOSTS = [
  'www.pathofexile.com',
  'api.pathofexile.com',
  'web.poecdn.com',
  'maxroll.gg',
  'pob.codes',
  'api.pob.codes',
  'pobb.in',
  'poe.ninja',
  'pastebin.com',
  'pastebinp.com',
  'rentry.co',
  'poedb.tw',
];
const MAX_REPLY = 256 * 1024 * 1024;
const TIMEOUT_MS = 300_000;
/** Headers of the page's request the site gets; the rest stay here. */
const PASS_REQUEST = ['accept', 'content-type', 'authorization'];
/** fetch has already undone the encoding; lengths and cookies are not passed. */
const DROP_REPLY = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'];
/** "poesessid" in ASCII, for the body search in any case. */
const NEEDLE = [...'poesessid'].map((c) => c.charCodeAt(0));

/** Headers every answer of this function carries (no _headers here). */
function isolate(h: Headers): Headers {
  h.set('cross-origin-opener-policy', 'same-origin');
  h.set('cross-origin-embedder-policy', 'require-corp');
  h.set('cross-origin-resource-policy', 'same-origin');
  h.set('cache-control', 'no-store');
  return h;
}

function refuse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: isolate(
      new Headers({ 'content-type': 'text/plain; charset=utf-8', 'x-pob-proxy': 'error' }),
    ),
  });
}

/** True when the bytes hold "poesessid" in any letter case. */
function holdsSessionId(bytes: Uint8Array): boolean {
  const n = NEEDLE.length;
  outer: for (let i = 0; i + n <= bytes.length; i++) {
    for (let j = 0; j < n; j++) {
      // ASCII letters only: setting bit 0x20 lower-cases A-Z and leaves a-z.
      if ((bytes[i + j] | 0x20) !== NEEDLE[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Counts what passes and stops the stream past the limit. */
function capped(body: ReadableStream<Uint8Array>, host: string): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > MAX_REPLY) {
          controller.error(new Error(`the reply of ${host} is larger than 256 MiB`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

async function proxy(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const body = request.method === 'POST' ? new Uint8Array(await request.arrayBuffer()) : null;

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return refuse(400, 'not an address');
  }
  const sent = [target, ...PASS_REQUEST.map((h) => request.headers.get(h) ?? '')].join('\n');
  if (/poesessid/i.test(sent) || (body && holdsSessionId(body))) {
    return refuse(403, 'A request with POESESSID is refused.');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !ALLOWED_HOSTS.includes(u.hostname)) {
    return refuse(403, `${u.hostname} is not among the sites the proxy asks.`);
  }

  const out = new Headers();
  for (const h of PASS_REQUEST) {
    const v = request.headers.get(h);
    if (v) out.set(h, v);
  }

  let reply: Response;
  try {
    reply = await fetch(u.href, {
      method: request.method,
      headers: out,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return refuse(502, `the proxy could not reach ${u.hostname}: ${(e as Error).name}`);
  }

  const length = reply.headers.get('content-length');
  const declared = length === null ? NaN : Number(length);
  if (declared > MAX_REPLY) {
    void reply.body?.cancel();
    return refuse(502, `the reply of ${u.hostname} is larger than 256 MiB`);
  }

  const back = new Headers();
  reply.headers.forEach((v, k) => {
    if (!DROP_REPLY.includes(k) && !k.startsWith('cross-origin-')) back.set(k, v);
  });
  back.set('x-pob-proxy', 'site');
  isolate(back);
  // A declared length is the wire length; the decoded body can be larger, but
  // a 256 MiB compressed reply is out of reach of anything PoB asks for.
  const stream = !reply.body
    ? null
    : Number.isFinite(declared)
      ? reply.body
      : capped(reply.body, u.hostname);
  return new Response(stream, { status: reply.status, headers: back });
}

async function guarded(request: Request): Promise<Response> {
  try {
    return await proxy(request);
  } catch (e) {
    console.error('proxy', e);
    return refuse(500, 'the proxy failed');
  }
}

/** Pages Functions entry points: one per method; others answer 405 from Pages. */
export const onRequestGet = (ctx: { request: Request }) => guarded(ctx.request);
export const onRequestPost = (ctx: { request: Request }) => guarded(ctx.request);
