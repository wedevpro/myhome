import { ApiError } from "./server";
export async function readJson(request:Request,limit=150000):Promise<unknown>{
 if(!request.body)throw new ApiError(400,"Contenu manquant.");
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let length=0;
 try{while(true){const result=await reader.read();if(result.done)break;length+=result.value.byteLength;if(length>limit){await reader.cancel();throw new ApiError(413,"Le contenu est trop volumineux.");}parts.push(result.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(400,"Le contenu de la requête est invalide.");}
}
