import { runDuePushNotifications } from "@/lib/push";
import { failure } from "@/lib/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 const token=request.headers.get("authorization");
 if(!process.env.REMINDER_SECRET||token!==`Bearer ${process.env.REMINDER_SECRET}`)return Response.json({error:"Accès refusé."},{status:403});
 try{return Response.json(await runDuePushNotifications(new Date(),new URL(request.url).origin));}catch(e){return failure(e);}
}
