/**
 * GET|POST /proxy?url=<https address> — Path of Building's proxy.
 *
 * The application at /pob/ asks build sites (pobb.in, poe.ninja, ...) and the
 * Path of Exile site straight from the page. Many refuse requests from other
 * pages (CORS); then it asks again through `/proxy?url=` on its own host
 * (vercel.json rewrites /proxy here). Without this it says the site cannot be
 * reached; everything else works.
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
 * The reply is streamed through rather than buffered: a buffered function
 * answer is capped far below 256 MiB on this platform.
 *
 * Every visitor's request leaves from this host's address, so a site may
 * rate-limit it.
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

function refuse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-pob-proxy': 'error',
    },
  });
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
  const sent = [
    target,
    ...PASS_REQUEST.map((h) => request.headers.get(h) ?? ''),
    body ? Buffer.from(body).toString('latin1') : '',
  ].join('\n');
  if (/poesessid/i.test(sent)) return refuse(403, 'A request with POESESSID is refused.');
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
    const cause = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name;
    return refuse(502, `the proxy could not reach ${u.hostname}: ${cause}`);
  }

  const declared = Number(reply.headers.get('content-length') ?? 0);
  if (declared > MAX_REPLY) {
    void reply.body?.cancel();
    return refuse(502, `the reply of ${u.hostname} is larger than 256 MiB`);
  }

  const back = new Headers();
  reply.headers.forEach((v, k) => {
    if (!DROP_REPLY.includes(k) && !k.startsWith('cross-origin-')) back.set(k, v);
  });
  back.set('x-pob-proxy', 'site');
  back.set('cross-origin-resource-policy', 'same-origin');
  back.set('cache-control', 'no-store');
  return new Response(reply.body ? capped(reply.body, u.hostname) : null, {
    status: reply.status,
    headers: back,
  });
}

async function guarded(request: Request): Promise<Response> {
  try {
    return await proxy(request);
  } catch (e) {
    console.error('proxy', e);
    return refuse(500, 'the proxy failed');
  }
}

export const GET = guarded;
export const POST = guarded;
