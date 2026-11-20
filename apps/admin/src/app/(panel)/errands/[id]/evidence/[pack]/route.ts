import { api, ApiError } from '@/lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A dispute's evidence pack as a file (docs/security-plan.md, E8), exactly as the API gives it: its SHA-256
 * can be worked out again from the content, with the keys in order, to show nothing changed since.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; pack: string }> }) {
  const { id, pack } = await params;
  if (!UUID.test(id) || !UUID.test(pack)) return new Response('Not found', { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await api<Record<string, unknown>>(`/admin/errands/${id}/evidence/${pack}`);
  } catch (error) {
    // The API's own answer, such as not found, rather than a server error.
    if (error instanceof ApiError) return new Response(error.message, { status: error.status });
    throw error;
  }
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="jiffo-evidence-${pack}.json"`,
      'cache-control': 'no-store',
    },
  });
}
