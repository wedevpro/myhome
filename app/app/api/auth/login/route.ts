import { authBody, authFailure, signIn } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return Response.json({ user: await signIn(await authBody(request)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authFailure(error); }
}
