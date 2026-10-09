import { authBody, authFailure, signUp } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return Response.json({ user: await signUp(await authBody(request)) }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authFailure(error); }
}
