import { z } from "zod";
import { identity,membership,database,failure,ApiError } from "@/lib/server";
import { vapidKeys,validEndpoint,sendPush } from "@/lib/push";
import { readJson } from "@/lib/json-body";
import { requestOriginAllowed } from "@/lib/auth";
export const dynamic="force-dynamic";
export async function GET(){try{await identity();const keys=await vapidKeys();return Response.json({publicKey:keys.publicKey},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
const subscription=z.object({endpoint:z.string().url().max(3000),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+$/).min(80).max(100),auth:z.string().regex(/^[A-Za-z0-9_-]+$/).min(20).max(30)})});
const command=z.object({action:z.enum(["subscribe","unsubscribe","test"]),householdId:z.string(),subscription:subscription.optional(),endpoint:z.string().optional()}).strict();
export async function POST(request:Request){try{
 if(!requestOriginAllowed(request))throw new ApiError(403,"Origine refusée.");
 const parsed=command.safeParse(await readJson(request,10000));if(!parsed.success)throw new ApiError(400,"Abonnement de notifications invalide.");
 const c=parsed.data,user=await identity();await membership(c.householdId,user.id);const db=database(),now=new Date().toISOString();
 if(c.action==="subscribe"){
  if(!c.subscription||!validEndpoint(c.subscription.endpoint))throw new ApiError(400,"Service Push non reconnu.");
  await db.prepare("INSERT INTO push_subscriptions(id,household_id,user_id,endpoint,data,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(endpoint,household_id,user_id) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(crypto.randomUUID(),c.householdId,user.id,c.subscription.endpoint,JSON.stringify(c.subscription),user.id,now,user.id,now).run();
 }else if(c.action==="unsubscribe"){
  await db.prepare("DELETE FROM push_subscriptions WHERE household_id=? AND user_id=? AND endpoint=?").bind(c.householdId,user.id,c.endpoint||"").run();
 }else{
  const subscriptions=await db.prepare("SELECT data FROM push_subscriptions WHERE household_id=? AND user_id=? AND endpoint=?").bind(c.householdId,user.id,c.endpoint||"").all<{data:string}>();
  if(!subscriptions.results.length)throw new ApiError(400,"Activez les notifications sur cet appareil avant de les tester.");
  for(const s of subscriptions.results){const status=await sendPush(JSON.parse(s.data),{title:"Bienvenue à la maison",body:"Les notifications MyHomeIA arrivent sur cet appareil.",url:"/",tag:"myhomeia-test"},process.env.SITE_ORIGIN||new URL(request.url).origin);if(status<200||status>=300)throw new ApiError(502,"Le service de notifications n’a pas accepté le message. Réactivez l’abonnement.");}
 }
 return Response.json({ok:true});
}catch(e){return failure(e);}}
