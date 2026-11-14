/** Client-side agent loop: proxy round-trips to /api/agent + local tool execution. */
import type { AgentApi, ChatMessage, LonLat, ToolDeps, TraceStep } from '../contracts';
import { findUnverifiedNumbers } from './numberGuard';
import { compactForModel, compactSnapshot, executeTool } from './tools';

export { executeTool };

const MAX_ROUNDS = 8;
const MAX_CALLS = 12;
const OLD_TOOL_CHARS = 1500;
const CURRENT_TOOL_CHARS = 3500;
const MAX_HISTORY_MESSAGES = 19; // server accepts 40; a turn adds up to 21
const SCENE_RE = /\n?<scene_context>[\s\S]*?<\/scene_context>/g;

type TurnResult = Awaited<ReturnType<AgentApi['runAgentTurn']>>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…[truncated]' : s);

/** Last 8 user turns; old turns lose scene context, old tool results are cut to 1.5 KB,
 *  and turns older than the two most recent keep only user text + final answer. */
export function prepareHistory(history: ChatMessage[]): ChatMessage[] {
  let turns: ChatMessage[][] = [];
  for (const m of history) {
    if (m.role === 'user') turns.push([m]);
    else if (turns.length) turns[turns.length - 1].push(m);
  }
  turns = turns.slice(-8);
  const out = turns.map((turn, i) => {
    const age = turns.length - 1 - i; // 0 = most recent prior turn
    const user = { ...turn[0], content: turn[0].content.replace(SCENE_RE, '') };
    if (age >= 2) {
      const final = [...turn].reverse().find((m) => m.role === 'assistant' && !m.tool_calls?.length && m.content);
      return final ? [user, { role: 'assistant', content: final.content } as ChatMessage] : [user];
    }
    return [user, ...turn.slice(1).map((m) => (m.role === 'tool' ? { ...m, content: clip(m.content, OLD_TOOL_CHARS) } : m))];
  });
  while (out.length > 1 && out.flat().length > MAX_HISTORY_MESSAGES) out.shift();
  return out.flat();
}

/* ---------------------------------------------------------------- labels */

function fmtLL(p: LonLat): string {
  return `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;
}
function fmtTarget(t: unknown, deps: ToolDeps): string {
  const snap = deps.world.snapshot();
  if (t === 'selected') return snap.selected ? fmtLL(snap.selected) : 'the selected point';
  if (t === 'base') return snap.base ? fmtLL(snap.base) : 'base';
  if (t && typeof t === 'object' && 'lon' in t && 'lat' in t) return fmtLL(t as LonLat);
  return 'the selected point';
}

export function describeToolCall(name: string, rawArgs: string, deps: ToolDeps): string {
  let a: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { a = rawArgs ? JSON.parse(rawArgs) : {}; } catch { /* label only */ }
  const slope = deps.world.snapshot().constraints.maxSlopeDeg;
  switch (name) {
    case 'get_scene_context': return 'Reading the scene';
    case 'get_location_context': return `Reading geology at ${fmtTarget(a.target, deps)}`;
    case 'find_science_context': return `Finding science sites near ${fmtTarget(a.target, deps)}`;
    case 'get_rover_images_near': return `Looking for rover images near ${fmtTarget(a.target, deps)}`;
    case 'analyze_terrain': return `Analysing terrain around ${fmtTarget(a.target, deps)}`;
    case 'set_mission_constraints': return `Updating mission limits (${Object.entries(a).map(([k, v]) => `${k} ${v}`).join(', ') || 'no change'})`;
    case 'suggest_science_stops': return `Searching ${a.objective ?? ''} science stops`.replace('  ', ' ');
    case 'plan_route': return `Solving ${a.roundTrip === false ? 'one-way route' : 'round trip'} (max slope ${slope}°)`;
    case 'plan_multi_stop': return `Solving multi-stop ${a.roundTrip === false ? 'route' : 'round trip'} (max slope ${slope}°)`;
    case 'compare_routes': return `Comparing routes ${Array.isArray(a.routeIds) ? a.routeIds.join(' and ') : ''}`.trim();
    case 'find_hazard_segments': return `Finding hazard segments on ${a.routeId ?? 'route'}`;
    case 'issue_scene_commands': {
      const cmds: { type?: string; routeId?: string }[] = Array.isArray(a.commands) ? a.commands : [];
      const draw = cmds.find((c) => c.type === 'draw_route');
      return draw ? `Drawing route ${draw.routeId}` : `Updating the 3D scene (${cmds.length} command${cmds.length === 1 ? '' : 's'})`;
    }
    case 'export_mission_plan': return `Exporting mission plan for ${a.routeId ?? 'route'}`;
    default: return `Running ${name}`;
  }
}

function summarize(name: string, result: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (result?.error) return String(result.message ?? result.error).slice(0, 120);
  if ((name === 'plan_route' || name === 'plan_multi_stop') && result?.id) {
    return `${result.id}: ${result.feasible ? 'feasible' : 'infeasible'}, ${result.totals?.lengthM} m, ${result.totals?.evaMin} min`;
  }
  if (name === 'issue_scene_commands') return `${result?.applied ?? 0} applied${result?.errors?.length ? `, ${result.errors.length} errors` : ''}`;
  return 'done';
}

/* ---------------------------------------------------------------- loop */

export async function runAgentTurn(args: Parameters<AgentApi['runAgentTurn']>[0]): Promise<TurnResult> {
  const { userText, history, deps, onTrace, signal } = args;
  const trace: TraceStep[] = [];
  const emit = () => onTrace(trace.map((s) => ({ ...s })));
  const fail = (extra: Partial<TurnResult>): TurnResult => ({
    text: '', history, trace, unverifiedNumbers: [], offline: false, ...extra,
  });

  const sceneJson = JSON.stringify(compactSnapshot(deps.world.snapshot()));
  const sources: string[] = [sceneJson, userText];
  const messages: ChatMessage[] = [
    ...prepareHistory(history),
    { role: 'user', content: `${userText}\n<scene_context>${sceneJson}</scene_context>` },
  ];

  let calls = 0;
  let lastText = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) return fail({ error: 'aborted' });
    let res: Response;
    try {
      res = await fetch('/api/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal,
      });
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return fail({ error: 'aborted' });
      return fail({ error: 'Could not reach the copilot service. Check your connection and try again.' });
    }
    if (res.status === 503) return fail({ offline: true });
    if (res.status === 429) return fail({ error: 'The copilot is busy (rate limit reached). Please wait a few minutes and try again.' });
    if (!res.ok) return fail({ error: `The copilot service returned an error (${res.status}). Please try again.` });

    let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { data = await res.json(); } catch { data = null; }
    const m = data?.message;
    if (!m || m.role !== 'assistant') return fail({ error: 'The copilot returned an unreadable response.' });
    const assistant: ChatMessage = {
      role: 'assistant', content: typeof m.content === 'string' ? m.content : '',
      ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}),
    };
    messages.push(assistant);
    if (assistant.content) lastText = assistant.content;

    if (!assistant.tool_calls) {
      return {
        text: assistant.content, history: messages, trace, offline: false,
        unverifiedNumbers: findUnverifiedNumbers(assistant.content, sources),
      };
    }

    for (const tc of assistant.tool_calls) {
      if (signal?.aborted) return fail({ error: 'aborted' });
      let content: string;
      if (calls >= MAX_CALLS) {
        content = JSON.stringify({ error: 'tool_call_limit', message: 'Tool call limit reached. Answer with what you have.' });
      } else {
        calls++;
        const step: TraceStep = {
          id: `t${calls}`, tool: tc.function.name, status: 'running',
          label: describeToolCall(tc.function.name, tc.function.arguments, deps),
        };
        trace.push(step);
        emit();
        const t0 = Date.now();
        const result = await executeTool(tc.function.name, tc.function.arguments, deps);
        step.ms = Date.now() - t0;
        step.status = (result as { error?: unknown })?.error ? 'error' : 'done';
        step.summary = summarize(tc.function.name, result);
        emit();
        sources.push(JSON.stringify(result));
        content = clip(JSON.stringify(compactForModel(tc.function.name, result)), CURRENT_TOOL_CHARS);
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
    }
  }
  return fail({
    text: lastText, history: messages,
    error: 'The copilot used its step limit before finishing. Try a more specific request.',
  });
}

export const agentApi: AgentApi = { runAgentTurn, executeTool };
