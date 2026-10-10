import { z } from "zod";
export const kindSchema=z.enum(["shopping","checklist","item","product","note","category","contact","electricity","waste"]);
const name=z.string().trim().min(1,"Le nom est obligatoire.").max(150);
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const barcode=z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9 ._\-]+$/);
const icon=z.enum(["basket","home","carrot","plane","check","heart","bag"]);
export const dataSchemas={
 shopping:z.object({name,icon:icon.default("basket")}),
 checklist:z.object({name,icon:icon.default("check"),reusable:z.boolean().default(false)}),
 item:z.object({name,listId:z.string().min(1),productId:z.string().optional(),checked:z.boolean().default(false),quantity:z.number().positive().max(10000).default(1),comment:z.string().max(2000).default(""),unit:z.string().max(50).default(""),category:z.string().max(100).default("")}),
 product:z.object({name,category:z.string().max(100).default(""),barcodes:z.array(barcode).max(100).default([])}),
 note:z.object({name,content:z.string().max(100000).default(""),color:z.enum(["purple","yellow","blue"]).default("purple")}),
 category:z.object({name,parentId:z.string().optional()}),
 contact:z.object({name,phone:z.string().max(60).default(""),email:z.union([z.literal(""),z.string().email().max(254)]).default(""),address:z.string().max(1000).default(""),categoryId:z.string().optional()}),
 electricity:z.object({name,start:time,end:time,days:z.array(z.number().int().min(0).max(6)).min(1).max(7)}).refine(d=>d.start!==d.end,"Les horaires de début et de fin doivent être différents."),
 waste:z.object({name,weekday:z.number().int().min(0).max(6),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),reminder:time,frequency:z.number().int().min(1).max(4).default(1),anchorDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).refine(d=>d.frequency===1||!!d.anchorDate,"Une date de référence est nécessaire pour les sorties espacées.")
};
export const preferenceSchema=z.object({shoppingId:z.string().optional(),checklistId:z.string().optional(),layout:z.enum(["side","rotate"]).optional(),rotation:z.number().int().min(5).max(300).optional(),camera:z.enum(["user","environment"]).optional(),peakColor:z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),offPeakColor:z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),notifications:z.boolean().optional()});
const itemIds=z.array(z.string().min(1).max(200)).max(10000).refine(ids=>new Set(ids).size===ids.length,"Une tâche ne peut apparaître qu’une fois dans l’ordre de la liste.");
const completedItems=z.array(z.object({id:z.string().min(1).max(200),revision:z.string().min(1).max(200)}).strict()).min(1).max(10000).refine(items=>new Set(items.map(item=>item.id)).size===items.length,"Un élément terminé ne peut être supprimé qu’une fois.");
export const commandSchema=z.object({action:z.enum(["createHousehold","joinHousehold","renameHousehold","rotateCode","save","delete","preferences","member","reset","addItem","reorderChecklist","clearCompleted"]),householdId:z.string().optional(),id:z.string().optional(),kind:kindSchema.optional(),data:z.unknown().optional(),expectedUpdatedAt:z.string().optional(),expectedRevision:z.string().optional(),name:name.optional(),code:z.string().trim().max(80).optional(),userId:z.string().optional(),role:z.enum(["admin","member","remove"]).optional(),listId:z.string().min(1).max(200).optional(),itemIds:itemIds.optional(),completedItems:completedItems.optional(),productId:z.string().optional(),saveProduct:z.boolean().optional(),barcode:barcode.optional(),quantity:z.number().positive().max(10000).optional(),unit:z.string().max(50).optional()}).strict();

