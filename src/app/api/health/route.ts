export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    agent: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.AGENT_MODEL ?? 'anthropic/claude-haiku-5.5',
  });
}
