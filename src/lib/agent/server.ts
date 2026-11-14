/** Server-side handler for POST /api/agent (OpenRouter proxy). Never logs keys or message bodies. */
import { z } from 'zod';
import { SYSTEM_PROMPT } from './prompt';
import { TOOL_SPECS } from './tools';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_BODY_BYTES = 60 * 1024;
const TIMEOUT_MS = 45_000;
/** Per-IP budget counts proxy ROUNDS (one user question can take up to 8). Default 100 per 10 min
 *  ≈ 12+ full questions per judge; override with AGENT_IP_CAPACITY. */
function ipCapacity(): number {
  const n = Number(process.env.AGENT_IP_CAPACITY ?? 100);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().max(30_000),
  tool_calls: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        type: z.literal('function'),
        function: z.object({ name: z.string().min(1).max(64), arguments: z.string().max(20_000) }),
      }),
    )
    .max(12)
    .optional(),
  tool_call_id: z.string().max(100).optional(),
  name: z.string().max(64).optional(),
});
const BodySchema = z.object({ messages: z.array(MessageSchema).min(1).max(40) });

/* ---- rate limiting (in-memory; per server instance) ---- */
const buckets = new Map<string, { tokens: number; ts: number }>();
let daily = { day: '', count: 0 };

export function resetAgentLimits() {
  buckets.clear();
  daily = { day: '', count: 0 };
}

function takeIpToken(ip: string, now: number): boolean {
  const cap = ipCapacity();
  const b = buckets.get(ip) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + (now - b.ts) * (cap / (10 * 60 * 1000)));
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.ts > 20 * 60 * 1000) buckets.delete(k);
  }
  return true;
}

function takeDaily(now: number): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (daily.day !== day) daily = { day, count: 0 };
  const cap = Number(process.env.AGENT_DAILY_CAP ?? 2000);
  if (daily.count >= (Number.isFinite(cap) ? cap : 2000)) return false;
  daily.count += 1;
  return true;
}

/** Client IP for rate limiting. Only a header named in CLIENT_IP_HEADER (set it to a header the hosting
 *  edge overwrites, e.g. "x-real-ip" on Railway) is trusted. Otherwise use the RIGHT-most X-Forwarded-For
 *  hop, which is appended by the proxy in front of us, never the client-controlled left-most entries.
 *  With neither, all callers share one bucket (fail closed). The global daily cap is a second backstop. */
function clientIp(req: Request): string {
  const trusted = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (trusted) {
    const v = req.headers.get(trusted)?.split(',').pop()?.trim();
    if (v) return v;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return 'shared';
}

/** Read the body as a stream, aborting as soon as it exceeds `limit` bytes. Returns null when too large. */
async function readBodyCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/* ---- upstream ---- */
type Upstream = { ok: true; data: any } | { ok: false; retryable: boolean; status: number }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function callUpstream(model: string, key: string, messages: unknown[]): Promise<Upstream> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'HeyMars',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_SPECS,
        tool_choice: 'auto',
        max_tokens: 900,
        temperature: 0.2,
        reasoning: { effort: 'low' },
      }),
    });
    if (!res.ok) return { ok: false, retryable: res.status >= 500, status: res.status };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, retryable: true, status: 0 }; // timeout / network
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAgentPost(req: Request): Promise<Response> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return json({ error: 'agent_offline' }, 503);

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const raw = await readBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) return json({ error: 'payload_too_large' }, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const parsed = BodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const msgs = parsed.data.messages;
  if (msgs[0].role !== 'user' || msgs[msgs.length - 1].role === 'assistant') return json({ error: 'bad_request' }, 400);

  const now = Date.now();
  if (!takeIpToken(clientIp(req), now) || !takeDaily(now)) return json({ error: 'rate_limited' }, 429);

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...msgs];
  const primary = process.env.AGENT_MODEL ?? 'anthropic/claude-haiku-5.5';
  const fallback = process.env.AGENT_FALLBACK_MODEL ?? 'openai/gpt-6-luna';

  let used = primary;
  let r = await callUpstream(primary, key, messages);
  if (!r.ok && r.retryable) {
    used = fallback;
    r = await callUpstream(fallback, key, messages);
  }
  if (!r.ok) return json({ error: 'upstream_error', status: r.status }, 502);

  const m = r.data?.choices?.[0]?.message;
  if (!m || typeof m !== 'object') return json({ error: 'upstream_error', status: 200 }, 502);
  const toolCalls = Array.isArray(m.tool_calls)
    ? m.tool_calls
        .filter((t: any) => t?.function?.name) // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((t: any, i: number) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
          id: String(t.id ?? `call_${i}`),
          type: 'function' as const,
          function: { name: String(t.function.name), arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}) },
        }))
    : [];
  // Only whitelisted fields: reasoning / reasoning_details never reach the client.
  const message = {
    role: 'assistant' as const,
    content: typeof m.content === 'string' ? m.content : '',
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
  return json({ message, model: r.data?.model ?? used, usage: r.data?.usage ?? null });
}
