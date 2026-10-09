import { getCurrentUser } from "./auth";
import { database } from "./sqlite";
import { ApiError } from "./api-error";
import { mapRecord } from "./records";
import type { Entity, Snapshot, User } from "./model";
export { database, ApiError, mapRecord };
export async function identity(): Promise<User> {
 const user = await getCurrentUser();
 if(!user) throw new ApiError(401,"Connectez-vous pour accéder à votre foyer.");
 return user;
}
export async function membership(householdId:string,userId:string,admin=false) {
 const m=await database().prepare("SELECT role FROM memberships WHERE household_id=? AND user_id=? AND status='active'").bind(householdId,userId).first<{role:string}>();
 if(!m || (admin && m.role!=="admin")) throw new ApiError(403,admin?"Cette action est réservée aux administrateurs du foyer.":"Vous n’avez pas accès à ce foyer.");
 return m;
}
export async function findRecord(id:string,householdId:string) {
 const row=await database().prepare("SELECT * FROM records WHERE id=? AND household_id=?").bind(id,householdId).first<Record<string,string>>();
 if(!row) throw new ApiError(404,"Cet élément n’existe plus. Actualisez la page.");
 return mapRecord(row);
}
export function insertRecord(e:Entity) { return database().prepare("INSERT INTO records(id,household_id,kind,data,revision,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(e.id,e.householdId,e.kind,JSON.stringify(e.data),e.revision,e.createdBy,e.createdAt,e.updatedBy,e.updatedAt); }
export async function snapshot(user:User,requested?:string|null):Promise<Snapshot> {
 const db=database();
 const hs=await db.prepare("SELECT h.id,h.name,h.code,m.role FROM households h JOIN memberships m ON m.household_id=h.id WHERE m.user_id=? AND m.status='active' ORDER BY h.created_at").bind(user.id).all();
 const households=hs.results as Snapshot["households"];
 if(requested && !households.some(h=>h.id===requested)) throw new ApiError(403,"Vous n’avez plus accès à ce foyer.");
 const household=households.find(h=>h.id===requested)||households[0]||null;
 if(!household) return {user,households,household:null,entities:[],members:[],preferences:{}};
 const [rs,ms,p]=await Promise.all([
 db.prepare("SELECT * FROM records WHERE household_id=? ORDER BY created_at,id").bind(household.id).all<Record<string,string>>(),
 db.prepare("SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.household_id=? AND m.status='active' ORDER BY u.name").bind(household.id).all(),
 db.prepare("SELECT data FROM preferences WHERE household_id=? AND user_id=?").bind(household.id,user.id).first<{data:string}>()
 ]);
 return {user,households,household,entities:rs.results.map(mapRecord),members:ms.results as Snapshot["members"],preferences:p?JSON.parse(p.data):{}};
}
export function failure(error:unknown) {
 if(error instanceof ApiError) return Response.json({error:error.message},{status:error.status});
 if(error instanceof Error && /UNIQUE constraint/.test(error.message)) return Response.json({error:"Ce code-barres est déjà associé à un autre produit du foyer."},{status:409});
 if(error instanceof Error && /MYHOME_REFERENCE|MYHOME_CYCLE/.test(error.message)) return Response.json({error:"Une liste, une catégorie ou un produit référencé a changé. Actualisez les données puis réessayez."},{status:409});
 console.error("MyHomeIA API error",error);
 return Response.json({error:"L’enregistrement a échoué. Vos données saisies sont conservées ; réessayez."},{status:500});
}
