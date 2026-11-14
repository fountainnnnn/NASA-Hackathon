import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareHistory, runAgentTurn } from '../../src/lib/agent/runner';
import type { ChatMessage, TraceStep } from '../../src/lib/contracts';
import { mockDeps } from './helpers';

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });
const reply = (message: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ message: { role: 'assistant', content: '', ...message }, model: 'm', usage: null }), { status });

afterEach(() => vi.unstubAllGlobals());

describe('runAgentTurn', () => {
  it('runs 2 tool rounds then returns text, with trace labels and number check', async () => {
    const m = mockDeps();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ tool_calls: [call('a', 'get_location_context', { target: 'selected' })] }))
      .mockResolvedValueOnce(reply({ tool_calls: [call('b', 'plan_route', { to: 'selected' })] }))
      .mockResolvedValueOnce(reply({ content: 'Round trip is 7.3 km, 125 min, but also 99 km.' }));
    vi.stubGlobal('fetch', fetchMock);
    const traces: TraceStep[][] = [];
    const out = await runAgentTurn({ userText: 'plan here', history: [], deps: m.deps, onTrace: (t) => traces.push(t) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out.text).toContain('7.3 km');
    expect(out.trace.map((t) => t.status)).toEqual(['done', 'done']);
    expect(out.trace[0].label).toBe('Reading geology at 18.50°N, 77.50°E');
    expect(out.trace[1].label).toBe('Solving round trip (max slope 15°)');
    expect(out.unverifiedNumbers).toEqual(['99 km']);
    expect(traces.length).toBeGreaterThanOrEqual(4);
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body.messages.map((x: ChatMessage) => x.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    expect(body.messages[0].content).toContain('<scene_context>');
    expect(body.tools).toBeUndefined();
    expect(out.history.at(-1)?.content).toContain('7.3 km');
  });

  it('respects the round cap and the tool-call cap', async () => {
    const m = mockDeps();
    const fetchMock = vi.fn().mockImplementation(async () =>
      reply({ tool_calls: [call('x1', 'get_scene_context', {}), call('x2', 'get_scene_context', {}), call('x3', 'get_scene_context', {})] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await runAgentTurn({ userText: 'loop', history: [], deps: m.deps, onTrace: () => {} });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(out.error).toBeTruthy();
    expect(out.trace.length).toBe(12);
  });

  it('handles 503 offline and 429', async () => {
    const m = mockDeps();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const off = await runAgentTurn({ userText: 'hi', history: [], deps: m.deps, onTrace: () => {} });
    expect(off.offline).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    const rl = await runAgentTurn({ userText: 'hi', history: [], deps: m.deps, onTrace: () => {} });
    expect(rl.offline).toBe(false);
    expect(rl.error).toMatch(/rate limit/);
  });

  it('honours AbortSignal', async () => {
    const m = mockDeps();
    const ctl = new AbortController();
    ctl.abort();
    const out = await runAgentTurn({ userText: 'hi', history: [], deps: m.deps, onTrace: () => {}, signal: ctl.signal });
    expect(out.error).toBe('aborted');
  });
});

describe('prepareHistory', () => {
  it('keeps at most 8 user turns, strips old scene context, truncates old tool results', () => {
    const h: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      h.push({ role: 'user', content: `q${i}\n<scene_context>{"a":1}</scene_context>` });
      h.push({ role: 'assistant', content: '', tool_calls: [call(`c${i}`, 'get_scene_context', {})] });
      h.push({ role: 'tool', tool_call_id: `c${i}`, name: 'get_scene_context', content: 'x'.repeat(5000) });
      h.push({ role: 'assistant', content: `a${i}` });
    }
    const out = prepareHistory(h);
    expect(out.length).toBeLessThanOrEqual(19);
    expect(out[0].role).toBe('user');
    expect(out.some((x) => x.content.includes('scene_context'))).toBe(false);
    expect(out.filter((x) => x.role === 'tool').every((x) => x.content.length < 1600)).toBe(true);
    expect(out.at(-1)?.content).toBe('a9');
  });
});
