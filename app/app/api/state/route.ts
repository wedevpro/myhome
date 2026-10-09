import { identity, snapshot, failure } from "@/lib/server";
export const dynamic="force-dynamic";
export async function GET(request:Request) { try { return Response.json(await snapshot(await identity(),new URL(request.url).searchParams.get("household")),{headers:{"Cache-Control":"no-store"}}); } catch(e){return failure(e);} }
