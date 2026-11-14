import { handleAgentPost } from '../../../lib/agent/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAgentPost(req);
}
