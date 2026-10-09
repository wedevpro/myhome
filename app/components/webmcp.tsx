"use client";
import { useEffect,useRef } from "react";
import type { Snapshot } from "@/lib/model";
type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown|Promise<unknown>};
type Context={registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>};
export default function WebMCP({snapshot,onStartAdd}:{snapshot:Snapshot;onStartAdd:(listId:string,name:string)=>void}){
 const current=useRef({snapshot,onStartAdd});current.current={snapshot,onStartAdd};
 useEffect(()=>{
  const context=(document as Document & {modelContext?:Context}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();
  const tools:Tool[]=[{
   name:"read_household_lists",title:"Consulter les listes du foyer",description:"Lit les listes et leurs éléments actuellement visibles pour le foyer actif.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){const {snapshot}=current.current;if(!input||typeof input!=="object"||Object.keys(input).length)throw new Error("Aucun paramètre attendu.");return {household:snapshot.household?.name||null,lists:snapshot.entities.filter(e=>e.kind==="shopping"||e.kind==="checklist").map(e=>({id:e.id,name:e.data.name,type:e.kind,items:snapshot.entities.filter(i=>i.data.listId===e.id).map(i=>({id:i.id,name:i.data.name,checked:!!i.data.checked}))}))};}
  },{
   name:"start_shopping_item_addition",title:"Préparer un ajout aux courses",description:"Ouvre le formulaire visible pour ajouter un produit à une liste de courses. L’utilisateur choisit sa quantité et confirme ; cet outil ne crée pas de produit.",inputSchema:{type:"object",properties:{listId:{type:"string"},name:{type:"string",minLength:1,maxLength:150}},required:["listId","name"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){const {snapshot,onStartAdd}=current.current;const value=input as Record<string,unknown>;if(!value||typeof value.listId!=="string"||typeof value.name!=="string"||!value.name.trim()||value.name.length>150||Object.keys(value).some(k=>k!=="listId"&&k!=="name"))throw new Error("Liste et nom du produit requis.");if(!snapshot.entities.some(e=>e.id===value.listId&&e.kind==="shopping"))throw new Error("Liste inaccessible dans ce foyer.");onStartAdd(value.listId,value.name.trim());return {status:"form_opened",listId:value.listId,name:value.name.trim()};}
  }];
  for(const tool of tools)try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
  return()=>lifecycle.abort();
 },[]);return null;
}
