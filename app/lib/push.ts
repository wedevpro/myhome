import { buildPushPayload,type PushSubscription } from "@block65/webcrypto-web-push";
import { database } from "./sqlite";
import { ApiError } from "./api-error";
import { mapRecord } from "./records";
import { getElectricity,upcomingWaste } from "./model";
function base64url(bytes:Uint8Array){let text="";for(const b of bytes)text+=String.fromCharCode(b);return btoa(text).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");}
export function validEndpoint(value:string){try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")&&(u.hostname==="fcm.googleapis.com"||u.hostname==="updates.push.services.mozilla.com"||u.hostname.endsWith(".push.services.mozilla.com")||u.hostname.endsWith(".push.apple.com")||u.hostname.endsWith(".notify.windows.com"));}catch{return false;}}
export async function vapidKeys(){const db=database();let row=await db.prepare("SELECT data FROM push_settings WHERE id='vapid'").first<{data:string}>();if(!row){const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);const raw=await crypto.subtle.exportKey("raw",pair.publicKey);const jwk=await crypto.subtle.exportKey("jwk",pair.privateKey);const value={publicKey:base64url(new Uint8Array(raw)),privateKey:jwk.d};const now=new Date().toISOString();await db.prepare("INSERT INTO push_settings(id,data,created_by,created_at,updated_by,updated_at) VALUES('vapid',?,'system',?,'system',?) ON CONFLICT(id) DO NOTHING").bind(JSON.stringify(value),now,now).run();row=await db.prepare("SELECT data FROM push_settings WHERE id='vapid'").first<{data:string}>();}if(!row)throw new ApiError(503,"Notifications indisponibles.");return JSON.parse(row.data) as {publicKey:string;privateKey:string};}
export async function sendPush(subscription:PushSubscription,message:{title:string;body:string;url:string;tag:string},origin:string){if(!validEndpoint(subscription.endpoint))throw new ApiError(400,"Service de notifications non reconnu.");const keys=await vapidKeys();const payload=await buildPushPayload({data:message,options:{ttl:3600,urgency:"normal"}},subscription,{...keys,subject:origin});const response=await fetch(subscription.endpoint,{...payload,redirect:"error",signal:AbortSignal.timeout(15000)});return response.status;}
export async function runDuePushNotifications(now=new Date(),origin=process.env.SITE_ORIGIN||"http://localhost:3000"){
 const db=database(),time=getElectricity([],now).time,date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const rows=await db.prepare("SELECT * FROM records WHERE kind='waste'").all<Record<string,string>>();let sent=0,failed=0;
 for(const rule of upcomingWaste(rows.results.map(mapRecord),now)){
  if(rule.days!==0||!rule.data.reminder||time<rule.data.reminder||time>=addMinutes(rule.data.reminder,30))continue;
  const subscriptions=await db.prepare("SELECT s.* FROM push_subscriptions s JOIN memberships m ON m.household_id=s.household_id AND m.user_id=s.user_id JOIN preferences p ON p.household_id=s.household_id AND p.user_id=s.user_id WHERE s.household_id=? AND m.status='active' AND json_extract(p.data,'$.notifications')=1").bind(rule.householdId).all<{id:string;data:string}>();
  for(const s of subscriptions.results){const id=`${s.id}:${rule.id}:${date}`,stamp=new Date().toISOString(),lease=new Date(Date.now()-120000).toISOString();const claim=await db.prepare("INSERT INTO push_deliveries(id,status,created_by,created_at,updated_by,updated_at) VALUES(?,'pending','system',?,'system',?) ON CONFLICT(id) DO UPDATE SET status='pending',updated_by='system',updated_at=excluded.updated_at WHERE push_deliveries.status!='sent' AND push_deliveries.updated_at<?").bind(id,stamp,stamp,lease).run();if(claim.meta.changes!==1)continue;
   try{const status=await sendPush(JSON.parse(s.data),{title:"Sortie des poubelles",body:`Pensez à sortir ${rule.data.name} ce soir.`,url:"/",tag:id},origin);
    if(status===404||status===410)await db.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(s.id).run();
    if(status>=200&&status<300){sent++;await db.prepare("UPDATE push_deliveries SET status='sent',updated_by='system',updated_at=? WHERE id=? AND updated_at=?").bind(new Date().toISOString(),id,stamp).run();}else{failed++;await db.prepare("UPDATE push_deliveries SET status='failed',updated_by='system',updated_at=? WHERE id=? AND updated_at=?").bind(stamp,id,stamp).run();}
   }catch(e){console.error("Push delivery failed",s.id,e);failed++;await db.prepare("UPDATE push_deliveries SET status='failed',updated_by='system',updated_at=? WHERE id=? AND updated_at=?").bind(stamp,id,stamp).run();}
  }
 }
 return {sent,failed};
}
function addMinutes(time:string,minutes:number){const [h,m]=time.split(":").map(Number);const total=Math.min(h*60+m+minutes,1440);return total===1440?"24:00":`${Math.floor(total/60).toString().padStart(2,"0")}:${(total%60).toString().padStart(2,"0")}`;}
