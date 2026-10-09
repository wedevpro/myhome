import { authBody, authFailure, signOut } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { await authBody(request); await signOut(); return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authFailure(error); }
}
