import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';

export const dynamic = 'force-dynamic';

// Public, read-only list of active models (no pricing internals, no provider credentials) for
// guest-facing search such as the command palette.
export async function GET() {
  try {
    const rows = await db
      .select({
        id: s.models.publicModelId,
        name: s.models.displayName,
        provider: s.providers.name,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
      })
      .from(s.models)
      .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
      .where(eq(s.models.status, 'active'));
    return NextResponse.json({ data: rows }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (err) {
    console.warn('[api/models] catalog read failed:', err);
    return NextResponse.json({ data: [] }, { status: 503 });
  }
}
