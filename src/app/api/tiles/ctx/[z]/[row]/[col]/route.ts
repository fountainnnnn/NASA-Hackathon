import { tileProxy } from '../../../../tileProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/tiles/ctx/{z}/{row}/{col}: one imagery tile through the fixed-upstream proxy and cache (see tileProxy.ts). */
export async function GET(_req: Request, ctx: { params: Promise<{ z: string; row: string; col: string }> }): Promise<Response> {
  return tileProxy().serve('ctx', await ctx.params);
}
