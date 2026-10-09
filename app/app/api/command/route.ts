import { commandSchema,dataSchemas,preferenceSchema } from "@/lib/validation";
import { database,identity,membership,findRecord,insertRecord,snapshot,failure,ApiError } from "@/lib/server";
import { audit, Entity, Data } from "@/lib/model";
import { readJson } from "@/lib/json-body";
import { requestOriginAllowed } from "@/lib/auth";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
 try {
  if(!requestOriginAllowed(request)) throw new ApiError(403,"Origine de la requête refusée.");
  if(Number(request.headers.get("content-length")||0)>150000) throw new ApiError(413,"Le contenu est trop volumineux.");
  const parsed=commandSchema.safeParse(await readJson(request));
  if(!parsed.success) throw new ApiError(400,parsed.error.issues[0].message);
  const c=parsed.data,user=await identity(),db=database(),now=new Date().toISOString();
  const fresh=(kind:Entity["kind"],data:Data,h:string):Entity=>({...audit(crypto.randomUUID(),kind,data,h),createdBy:user.id,updatedBy:user.id,createdAt:now,updatedAt:now});
  let h=c.householdId;
  if(c.action==="createHousehold") {
   if(!c.name) throw new ApiError(400,"Donnez un nom à votre foyer.");
   h=crypto.randomUUID();const code=crypto.randomUUID().replaceAll("-","").slice(0,20).toUpperCase();
   await db.batch([
    db.prepare("INSERT INTO households(id,name,code,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(h,c.name,code,user.id,now,user.id,now),
    db.prepare("INSERT INTO memberships(household_id,user_id,role,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,'admin','active',?,?,?,?)").bind(h,user.id,user.id,now,user.id,now),
    insertRecord(fresh("shopping",{name:"Courses de la semaine",icon:"basket"},h)),insertRecord(fresh("checklist",{name:"Les petites choses à faire",icon:"check",reusable:false},h))
   ]);
  } else if(c.action==="joinHousehold") {
   const found=await db.prepare("SELECT id FROM households WHERE code=?").bind((c.code||"").replaceAll(" ","").toUpperCase()).first<{id:string}>();
   if(!found) throw new ApiError(404,"Ce code de foyer est introuvable. Vérifiez-le auprès d’un administrateur.");
   h=found.id;
   const previous=await db.prepare("SELECT status FROM memberships WHERE household_id=? AND user_id=?").bind(h,user.id).first<{status:string}>();
   if(previous?.status==="removed") throw new ApiError(403,"Votre accès a été retiré. Contactez un administrateur du foyer.");
   if(!previous) await db.prepare("INSERT INTO memberships(household_id,user_id,role,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,'member','active',?,?,?,?)").bind(h,user.id,user.id,now,user.id,now).run();
  } else {
   if(!h) throw new ApiError(400,"Sélectionnez un foyer.");
   await membership(h,user.id,["member","renameHousehold","rotateCode"].includes(c.action)||(["electricity","waste"].includes(c.kind||"")));
   if(c.action==="save") {
    if(!c.kind) throw new ApiError(400,"Type d’élément manquant.");
    const checked=dataSchemas[c.kind].safeParse(c.data);
    if(!checked.success) throw new ApiError(400,checked.error.issues[0].message);
    const data=checked.data as Data;
    if(data.listId) { const list=await findRecord(data.listId,h);if(!["shopping","checklist"].includes(list.kind)) throw new ApiError(400,"Liste invalide."); }
    if(data.productId && (await findRecord(data.productId,h)).kind!=="product") throw new ApiError(400,"Produit invalide.");
    if(data.categoryId && (await findRecord(data.categoryId,h)).kind!=="category") throw new ApiError(400,"Catégorie invalide.");
    if(c.kind==="category" && data.parentId) {
     const seen=new Set<string>(c.id?[c.id]:[]);let parent:string|undefined=data.parentId;
     while(parent) {if(seen.has(parent)) throw new ApiError(400,"Une catégorie ne peut pas être son propre descendant.");seen.add(parent);const p=await findRecord(parent,h);if(p.kind!=="category") throw new ApiError(400,"Catégorie parente invalide.");parent=p.data.parentId;}
    }
    if(c.kind==="waste" && data.anchorDate && new Date(data.anchorDate+"T12:00:00Z").getUTCDay()!==data.weekday) throw new ApiError(400,"La date de référence doit correspondre au jour de sortie choisi.");
    const previous=c.id?await findRecord(c.id,h):null;
    if(previous && previous.kind!==c.kind) throw new ApiError(400,"Le type d’élément ne peut pas changer.");
    if(previous && (!c.expectedRevision||previous.revision!==c.expectedRevision)) throw new ApiError(409,"Cet élément a été modifié sur un autre appareil. Rouvrez-le pour récupérer la dernière version.");
    const e=previous?{...previous,data,updatedBy:user.id,updatedAt:now,revision:crypto.randomUUID()}:fresh(c.kind,data,h);
    if(c.kind==="product") {
     const codes=[...new Set(data.barcodes||[])];e.data.barcodes=codes;
     const statements=previous?[db.prepare("UPDATE records SET data=?,updated_by=?,updated_at=?,revision=? WHERE id=? AND household_id=? AND revision=?").bind(JSON.stringify(e.data),user.id,now,e.revision,e.id,h,c.expectedRevision)]:[insertRecord(e)];
     statements.push(db.prepare("DELETE FROM barcodes WHERE product_id=? AND household_id=? AND code NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM records WHERE id=? AND revision=? AND updated_by=?)").bind(e.id,h,JSON.stringify(codes),e.id,e.revision,user.id));
     for(const code of codes) statements.push(db.prepare("INSERT INTO barcodes(household_id,code,product_id,created_by,created_at,updated_by,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND revision=? AND updated_by=?) AND NOT EXISTS(SELECT 1 FROM barcodes WHERE household_id=? AND code=? AND product_id=?)").bind(h,code,e.id,user.id,now,user.id,now,e.id,e.revision,user.id,h,code,e.id));
     // An optimistic no-op must not replace barcode associations.
     const collision=await db.prepare("SELECT code FROM barcodes WHERE household_id=? AND product_id!=? AND code IN (SELECT value FROM json_each(?)) LIMIT 1").bind(h,e.id,JSON.stringify(codes)).first();
     if(collision) throw new ApiError(409,"Ce code-barres est déjà associé à un autre produit.");
     const result=await db.batch(statements);
     if(previous && result[0].meta.changes!==1) throw new ApiError(409,"Modification simultanée : actualisez le produit.");
    } else if(previous) {
     const result=await db.prepare("UPDATE records SET data=?,updated_by=?,updated_at=?,revision=? WHERE id=? AND household_id=? AND revision=?").bind(JSON.stringify(data),user.id,now,e.revision,e.id,h,c.expectedRevision).run();
     if(result.meta.changes!==1) throw new ApiError(409,"Modification simultanée : rouvrez cet élément.");
    } else await insertRecord(e).run();
   } else if(c.action==="delete") {
    const e=await findRecord(c.id||"",h);
    if(["waste","electricity"].includes(e.kind)) await membership(h,user.id,true);
    if(!c.expectedRevision||e.revision!==c.expectedRevision) throw new ApiError(409,"Cet élément a changé. Actualisez-le avant de le supprimer.");
    if(e.kind==="category") {
     const linked=await db.prepare("SELECT id FROM records WHERE household_id=? AND (json_extract(data,'$.parentId')=? OR json_extract(data,'$.categoryId')=?) LIMIT 1").bind(h,e.id,e.id).first();
     if(linked) throw new ApiError(409,"Déplacez d’abord les sous-catégories et les contacts de cette catégorie.");
    }
    if(e.kind==="product") {const linked=await db.prepare("SELECT id FROM records WHERE household_id=? AND json_extract(data,'$.productId')=? LIMIT 1").bind(h,e.id).first();if(linked) throw new ApiError(409,"Ce produit est utilisé dans une liste. Retirez les articles associés avant de le supprimer.");}
    const statements=[];
    if(["shopping","checklist"].includes(e.kind)) statements.push(db.prepare("DELETE FROM records WHERE household_id=? AND json_extract(data,'$.listId')=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active')").bind(h,e.id,e.id,c.expectedRevision,h,user.id));
    statements.push(db.prepare("DELETE FROM records WHERE id=? AND household_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active' AND (? NOT IN ('electricity','waste') OR role='admin'))").bind(e.id,h,c.expectedRevision,h,user.id,e.kind));
    const results=await db.batch(statements);if(results.at(-1)?.meta.changes!==1) throw new ApiError(409,"Cet élément a changé. Actualisez-le.");
   } else if(c.action==="preferences") {
    const p=preferenceSchema.safeParse(c.data);if(!p.success) throw new ApiError(400,p.error.issues[0].message);
    for(const [key,kind] of [["shoppingId","shopping"],["checklistId","checklist"]] as const) {const id=p.data[key];if(id && (await findRecord(id,h)).kind!==kind) throw new ApiError(400,"Liste de tableau de bord invalide.");}
    await db.prepare("INSERT INTO preferences(household_id,user_id,data,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(household_id,user_id) DO UPDATE SET data=json_patch(preferences.data,excluded.data),updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(h,user.id,JSON.stringify(p.data),user.id,now,user.id,now).run();
   } else if(c.action==="member") {
    if(!c.userId||!c.role) throw new ApiError(400,"Utilisateur ou rôle manquant.");
    const result=await db.prepare("UPDATE memberships SET role=?,status=?,updated_by=?,updated_at=? WHERE household_id=? AND user_id=? AND status='active' AND (role!='admin' OR ?='admin' OR (SELECT COUNT(*) FROM memberships WHERE household_id=? AND role='admin' AND status='active')>1)").bind(c.role==="admin"?"admin":"member",c.role==="remove"?"removed":"active",user.id,now,h,c.userId,c.role,h).run();
    if(result.meta.changes!==1) throw new ApiError(409,"Le foyer doit conserver au moins un administrateur.");
   } else if(c.action==="renameHousehold") {
    if(!c.name) throw new ApiError(400,"Nom manquant.");
    await db.prepare("UPDATE households SET name=?,updated_by=?,updated_at=? WHERE id=?").bind(c.name,user.id,now,h).run();
   } else if(c.action==="rotateCode") {
    await db.prepare("UPDATE households SET code=?,updated_by=?,updated_at=? WHERE id=?").bind(crypto.randomUUID().replaceAll("-","").slice(0,20).toUpperCase(),user.id,now,h).run();
   } else if(c.action==="reset") {
    const list=await findRecord(c.listId||"",h);if(list.kind!=="checklist"||!list.data.reusable) throw new ApiError(400,"Cette liste n’est pas réutilisable.");
    await db.prepare("UPDATE records SET data=json_set(data,'$.checked',json('false')),updated_by=?,updated_at=?,revision=? WHERE household_id=? AND kind='item' AND json_extract(data,'$.listId')=?").bind(user.id,now,crypto.randomUUID(),h,list.id).run();
   } else if(c.action==="addItem") {
    const list=await findRecord(c.listId||"",h);if(!["shopping","checklist"].includes(list.kind)) throw new ApiError(400,"Liste invalide.");
    let product=c.productId?await findRecord(c.productId,h):null;
    if(product && product.kind!=="product") throw new ApiError(400,"Produit invalide.");
    if(c.barcode) {const linked=await db.prepare("SELECT product_id FROM barcodes WHERE household_id=? AND code=?").bind(h,c.barcode).first<{product_id:string}>();if(linked) product=await findRecord(linked.product_id,h);}
    if(!product&&!c.name) throw new ApiError(400,"Choisissez un produit ou saisissez son nom.");
    const statements=[];
    const creatingProduct=!product&&(c.saveProduct||c.barcode);
    if(creatingProduct) {product=fresh("product",{name:c.name,category:"",barcodes:c.barcode?[c.barcode]:[]},h);statements.push(insertRecord(product));}
    if(c.barcode&&product) {
     const exists=await db.prepare("SELECT product_id FROM barcodes WHERE household_id=? AND code=?").bind(h,c.barcode).first();
     if(!exists) {
      statements.push(db.prepare("INSERT INTO barcodes(household_id,code,product_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(h,c.barcode,product.id,user.id,now,user.id,now));
      if(!creatingProduct) statements.push(db.prepare("UPDATE records SET data=json_insert(data,'$.barcodes[#]',?),updated_by=?,updated_at=?,revision=? WHERE household_id=? AND id=?").bind(c.barcode,user.id,now,crypto.randomUUID(),h,product.id));
     }
    }
    statements.push(insertRecord(fresh("item",{name:product?.data.name||c.name,listId:list.id,productId:product?.id,quantity:c.quantity||1,unit:c.unit||"",category:product?.data.category||"",checked:false},h)));
    await db.batch(statements);
   }
  }
  // Removing oneself may change the active household.
  const stillMember=h?await db.prepare("SELECT user_id FROM memberships WHERE household_id=? AND user_id=? AND status='active'").bind(h,user.id).first():null;
  return Response.json(await snapshot(user,stillMember?h:null),{headers:{"Cache-Control":"no-store"}});
 } catch(e) {return failure(e);}
}

