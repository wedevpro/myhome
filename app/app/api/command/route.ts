import { commandSchema,dataSchemas,preferenceSchema } from "@/lib/validation";
import { database,identity,membership,findRecord,insertRecord,snapshot,failure,ApiError,mapRecord } from "@/lib/server";
import { audit, Entity, Data } from "@/lib/model";
import { readJson } from "@/lib/json-body";
import { requestOriginAllowed } from "@/lib/auth";
import { findProductsByName,normalizeProductName } from "@/lib/product-matching";
export const dynamic="force-dynamic";
const commandBodyLimit=1_200_000;
// Check both references inside the write: a target may disappear after validation.
const checklistLinkExists="EXISTS(SELECT 1 FROM records parent JOIN records target ON target.household_id=parent.household_id WHERE parent.id=? AND parent.household_id=? AND parent.kind='checklist' AND target.id=? AND target.kind='checklist' AND target.id!=parent.id)";
export async function POST(request:Request) {
 try {
  if(!requestOriginAllowed(request)) throw new ApiError(403,"Origine de la requête refusée.");
  if(Number(request.headers.get("content-length")||0)>commandBodyLimit) throw new ApiError(413,"Le contenu est trop volumineux.");
  const parsed=commandSchema.safeParse(await readJson(request,commandBodyLimit));
  if(!parsed.success) throw new ApiError(400,parsed.error.issues[0].message);
  const c=parsed.data,user=await identity(),db=database(),now=new Date().toISOString();
  const fresh=(kind:Entity["kind"],data:Data,h:string):Entity=>({...audit(crypto.randomUUID(),kind,data,h),createdBy:user.id,updatedBy:user.id,createdAt:now,updatedAt:now});
  const validateChecklistLink=async(list:Entity|null,id:string|undefined)=>{
   if(!id) return;
   if(list?.kind!=="checklist") throw new ApiError(400,"Seul un élément de checklist peut être lié à une autre checklist.");
   const target=await findRecord(id,list.householdId);
   if(target.kind!=="checklist") throw new ApiError(400,"La liste liée doit être une checklist.");
   if(target.id===list.id) throw new ApiError(400,"Choisissez une autre checklist que celle de cet élément.");
  };
  const insertLinkedItem=(e:Entity)=>db.prepare(`INSERT INTO records(id,household_id,kind,data,revision,created_by,created_at,updated_by,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${checklistLinkExists}`).bind(e.id,e.householdId,e.kind,JSON.stringify(e.data),e.revision,e.createdBy,e.createdAt,e.updatedBy,e.updatedAt,e.data.listId,e.householdId,e.data.linkedChecklistId);
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
    const list=data.listId?await findRecord(data.listId,h):null;
    if(list && !["shopping","checklist"].includes(list.kind)) throw new ApiError(400,"Liste invalide.");
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
    await validateChecklistLink(list,data.linkedChecklistId);
    // Only reorderChecklist may change ordering; editors must preserve it.
    if(previous?.kind==="checklist" && Array.isArray(previous.data.itemOrder)) data.itemOrder=[...previous.data.itemOrder];
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
     const result=await db.prepare("UPDATE records SET data=?,updated_by=?,updated_at=?,revision=? WHERE id=? AND household_id=? AND revision=?"+(data.linkedChecklistId?` AND ${checklistLinkExists}`:"")).bind(JSON.stringify(data),user.id,now,e.revision,e.id,h,c.expectedRevision,...(data.linkedChecklistId?[data.listId,h,data.linkedChecklistId]:[])).run();
     if(result.meta.changes!==1) throw new ApiError(409,"Modification simultanée : rouvrez cet élément.");
    } else {
     const result=await (data.linkedChecklistId?insertLinkedItem(e):insertRecord(e)).run();
     if(result.meta.changes!==1) throw new ApiError(409,"La checklist liée a changé. Actualisez les données.");
    }
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
    if(e.kind==="checklist") statements.push(db.prepare("UPDATE records SET data=json_remove(data,'$.linkedChecklistId'),updated_by=?,updated_at=?,revision=lower(hex(randomblob(16))) WHERE household_id=? AND kind='item' AND json_extract(data,'$.linkedChecklistId')=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND household_id=? AND kind='checklist' AND revision=?) AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active')").bind(user.id,now,h,e.id,e.id,h,c.expectedRevision,h,user.id));
    if(["shopping","checklist"].includes(e.kind)) statements.push(db.prepare("DELETE FROM records WHERE household_id=? AND json_extract(data,'$.listId')=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active')").bind(h,e.id,e.id,c.expectedRevision,h,user.id));
    statements.push(db.prepare("DELETE FROM records WHERE id=? AND household_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active' AND (? NOT IN ('electricity','waste') OR role='admin'))").bind(e.id,h,c.expectedRevision,h,user.id,e.kind));
    const results=await db.batch(statements);if(results.at(-1)?.meta.changes!==1) throw new ApiError(409,"Cet élément a changé. Actualisez-le.");
   } else if(c.action==="clearCompleted") {
    if(!c.listId || !c.completedItems) throw new ApiError(400,"Choisissez une liste et indiquez les éléments terminés à supprimer.");
    const list=await findRecord(c.listId,h);
    if(!["shopping","checklist"].includes(list.kind)) throw new ApiError(400,"Cette action concerne les listes de courses et les checklists éphémères.");
    if(list.kind==="checklist" && list.data.reusable) throw new ApiError(400,"Les éléments d’une checklist réutilisable doivent être conservés.");
    // Materialize the complete eligibility check before deleting the first row.
    // No count can change midway through the DELETE, and concurrent writes are
    // serialized with this statement. Newly checked items outside the request stay.
    const result=await db.prepare(`
     WITH requested(id,revision) AS MATERIALIZED (
           SELECT json_extract(value,'$.id'),json_extract(value,'$.revision') FROM json_each(?)
          ),
          matching(id) AS MATERIALIZED (
           SELECT r.id FROM records r JOIN requested q ON q.id=r.id AND q.revision=r.revision
           WHERE r.household_id=? AND r.kind='item' AND json_extract(r.data,'$.listId')=?
            AND json_type(r.data,'$.checked')='true'
          ),
          allowed(ok) AS MATERIALIZED (
           SELECT 1
           WHERE (SELECT COUNT(*) FROM requested)=(SELECT COUNT(*) FROM matching)
            AND (SELECT COUNT(*) FROM requested)=(SELECT COUNT(DISTINCT id) FROM requested)
            AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active')
            AND EXISTS(SELECT 1 FROM records WHERE id=? AND household_id=?
             AND (kind='shopping' OR (kind='checklist' AND COALESCE(json_extract(data,'$.reusable'),0)=0)))
          )
     DELETE FROM records WHERE household_id=? AND kind='item'
      AND id IN (SELECT id FROM matching) AND EXISTS(SELECT 1 FROM allowed)
    `).bind(JSON.stringify(c.completedItems),h,list.id,h,user.id,list.id,h,h).run();
    if(result.meta.changes!==c.completedItems.length) throw new ApiError(409,"Un élément terminé ou la liste a changé. Actualisez les données avant de réessayer.");
    // Keep the list's audit/revision and itemOrder: readers ignore deleted IDs.
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
   } else if(c.action==="reorderChecklist") {
    if(!c.listId || !c.itemIds) throw new ApiError(400,"Choisissez une checklist et indiquez l’ordre complet de ses tâches.");
    const list=await findRecord(c.listId,h);
    if(list.kind!=="checklist") throw new ApiError(400,"Seules les checklists peuvent être réordonnées.");
    if(!c.expectedRevision || list.revision!==c.expectedRevision) throw new ApiError(409,"Cette checklist a changé. Actualisez-la avant de réordonner ses tâches.");
    const order=JSON.stringify(c.itemIds),revision=crypto.randomUUID();
    // The complete set, revision and access are checked inside the write.
    // SQLite serializes this statement with concurrent inserts and deletes.
    const result=await db.prepare(`
     WITH requested(id) AS (SELECT value FROM json_each(?)),
          current_items(id) AS (
           SELECT id FROM records
           WHERE household_id=? AND kind='item' AND json_extract(data,'$.listId')=?
          )
     UPDATE records SET data=json_set(data,'$.itemOrder',json(?)),updated_by=?,updated_at=?,revision=?
     WHERE id=? AND household_id=? AND kind='checklist' AND revision=?
      AND EXISTS(SELECT 1 FROM memberships WHERE household_id=? AND user_id=? AND status='active')
      AND (SELECT COUNT(*) FROM requested)=(SELECT COUNT(*) FROM current_items)
      AND (SELECT COUNT(*) FROM requested)=(SELECT COUNT(DISTINCT id) FROM requested)
      AND NOT EXISTS(SELECT id FROM current_items EXCEPT SELECT id FROM requested)
    `).bind(order,h,list.id,order,user.id,now,revision,list.id,h,c.expectedRevision,h,user.id).run();
    if(result.meta.changes!==1) throw new ApiError(409,"Cette checklist ou ses tâches ont changé. Actualisez-la avant de réordonner ses tâches.");
   } else if(c.action==="reset") {
    const list=await findRecord(c.listId||"",h);if(list.kind!=="checklist"||!list.data.reusable) throw new ApiError(400,"Cette liste n’est pas réutilisable.");
    await db.prepare("UPDATE records SET data=json_set(data,'$.checked',json('false')),updated_by=?,updated_at=?,revision=? WHERE household_id=? AND kind='item' AND json_extract(data,'$.listId')=?").bind(user.id,now,crypto.randomUUID(),h,list.id).run();
   } else if(c.action==="addItem") {
    const list=await findRecord(c.listId||"",h);if(!["shopping","checklist"].includes(list.kind)) throw new ApiError(400,"Liste invalide.");
    await validateChecklistLink(list,c.linkedChecklistId);
    if(c.linkedChecklistId && (c.productId||c.barcode||c.saveProduct)) throw new ApiError(400,"Un élément lié à une checklist ne peut pas être associé à un produit.");
    let product=c.productId?await findRecord(c.productId,h):null;
    if(product && product.kind!=="product") throw new ApiError(400,"Produit invalide.");
    if(c.barcode) {
     const linked=await db.prepare("SELECT product_id FROM barcodes WHERE household_id=? AND code=?").bind(h,c.barcode).first<{product_id:string}>();
     if(linked) {
      const owner=await findRecord(linked.product_id,h);
      if((c.productId&&c.productId!==owner.id)||(!c.productId&&c.name&&normalizeProductName(c.name)!==normalizeProductName(owner.data.name||""))) throw new ApiError(409,"Ce code-barres est déjà associé à un autre produit. Actualisez les produits puis réessayez.");
      product=owner;
     }
    }
    if(c.barcode&&!product&&c.name&&list.kind==="shopping") {
     const catalogue=await db.prepare("SELECT * FROM records WHERE household_id=? AND kind='product' ORDER BY created_at,id").bind(h).all<Record<string,string>>();
     const matches=findProductsByName(catalogue.results.map(mapRecord),c.name);
     if(matches.length>1) throw new ApiError(409,"Plusieurs produits portent ce nom. Choisissez le produit dans les suggestions.");
     product=matches[0]||null;
    }
    if(!product&&!c.name) throw new ApiError(400,"Choisissez un produit ou saisissez son nom.");
    const statements=[];
    const creatingProduct=!product&&(c.saveProduct||c.barcode);
    if(creatingProduct) {product=fresh("product",{name:c.name,category:"",barcodes:c.barcode?[c.barcode]:[]},h);statements.push(insertRecord(product));}
    if(c.barcode&&product) {
     const exists=await db.prepare("SELECT product_id FROM barcodes WHERE household_id=? AND code=?").bind(h,c.barcode).first<{product_id:string}>();
     if(exists&&exists.product_id!==product.id) throw new ApiError(409,"Ce code-barres est déjà associé à un autre produit. Actualisez les produits puis réessayez.");
     if(!exists) {
      statements.push(db.prepare("INSERT INTO barcodes(household_id,code,product_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(h,c.barcode,product.id,user.id,now,user.id,now));
      if(!creatingProduct) statements.push(db.prepare("UPDATE records SET data=json_insert(data,'$.barcodes[#]',?),updated_by=?,updated_at=?,revision=? WHERE household_id=? AND id=?").bind(c.barcode,user.id,now,crypto.randomUUID(),h,product.id));
     }
    }
    const item=fresh("item",{name:product?.data.name||c.name,listId:list.id,linkedChecklistId:c.linkedChecklistId,productId:product?.id,quantity:c.quantity||1,unit:c.unit||"",category:product?.data.category||"",checked:false},h);
    statements.push(c.linkedChecklistId?insertLinkedItem(item):insertRecord(item));
    const results=await db.batch(statements);
    if(results.at(-1)?.meta.changes!==1) throw new ApiError(409,"La checklist liée a changé. Actualisez les données.");
   }
  }
  // Removing oneself may change the active household.
  const stillMember=h?await db.prepare("SELECT user_id FROM memberships WHERE household_id=? AND user_id=? AND status='active'").bind(h,user.id).first():null;
  return Response.json(await snapshot(user,stillMember?h:null),{headers:{"Cache-Control":"no-store"}});
 } catch(e) {return failure(e);}
}

