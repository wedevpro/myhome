"use client";
import { useEffect,useRef,useState } from "react";
import { Camera,ScanBarcode } from "lucide-react";
import { DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { Choice } from "./entity-editor";
export default function BarcodeScanner({camera,onCamera,onCode}:{camera:"user"|"environment";onCamera:(v:"user"|"environment")=>void;onCode:(code:string)=>void}) {
 const video=useRef<HTMLVideoElement>(null);
 const [active,setActive]=useState(false),[error,setError]=useState(""),[code,setCode]=useState("");
 const callback=useRef(onCode);callback.current=onCode;
 useEffect(()=>{
  if(!active||!video.current)return;
  let cancelled=false,controls:{stop:()=>void}|undefined;
  async function start(){try {
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("La caméra exige une connexion HTTPS et un navigateur compatible.");
   const {BrowserMultiFormatReader}=await import("@zxing/browser");
   const reader=new BrowserMultiFormatReader();
   controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:camera},width:{ideal:1280},height:{ideal:720}},audio:false},video.current!,result=>{if(result&&!cancelled){cancelled=true;controls?.stop();setActive(false);callback.current(result.getText());}});
   if(cancelled)controls.stop();
  }catch(e){if(!cancelled){setError(e instanceof Error?e.message:"Impossible d’ouvrir la caméra. Vérifiez son autorisation.");setActive(false);}}}
  void start();const current=video.current;
  return ()=>{cancelled=true;controls?.stop();if(current?.srcObject instanceof MediaStream)current.srcObject.getTracks().forEach(t=>t.stop());};
 },[active,camera]);
 return <><DialogTitle className="dialog-title">Scanner un produit</DialogTitle><DialogDescription>Un code reconnu ajoute directement le produit à la liste.</DialogDescription><div className="form-stack"><Choice label="Caméra à utiliser" value={camera} onChange={v=>onCamera(v as "user"|"environment")} options={[{value:"environment",label:"Caméra arrière — téléphone"},{value:"user",label:"Caméra avant — tablette murale"}]}/>{active&&<video ref={video} className="camera-video" playsInline muted autoPlay/>}<button className="secondary-button" onClick={()=>{setError("");setActive(v=>!v);}}><Camera size={17}/>{active?"Arrêter la caméra":"Ouvrir la caméra"}</button>{error&&<p className="error-text" role="alert">{error}</p>}<form className="form-stack" onSubmit={e=>{e.preventDefault();const value=code.trim();if(value){setActive(false);onCode(value);}}}><label className="field">Douchette ou saisie manuelle<input autoFocus aria-label="Code-barres" placeholder="Placez le curseur ici, puis scannez" value={code} onChange={e=>setCode(e.target.value)} maxLength={80}/></label><p className="helper">Une douchette en mode clavier USB ou Bluetooth saisit le code ici. Configurez le suffixe « Entrée » pour valider automatiquement.</p><button className="primary-button" type="submit" disabled={!code.trim()}><ScanBarcode size={17}/>Ajouter ce code</button></form></div></>;
}
