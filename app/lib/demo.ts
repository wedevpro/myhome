import { audit, Snapshot } from "./model";
export function demoSnapshot(): Snapshot {
  const entities = [
    audit("s1","shopping",{name:"Courses de la semaine",icon:"basket"}),
    audit("s2","shopping",{name:"Le marché du dimanche",icon:"carrot"}),
    audit("s3","shopping",{name:"Pour la maison",icon:"home"}),
    audit("c1","checklist",{name:"Les petites choses à faire",icon:"check",reusable:false}),
    audit("c2","checklist",{name:"Prêts pour les vacances",icon:"plane",reusable:true}),
    ...[{name:"Avocats",category:"Fruits & légumes",quantity:2,unit:"pièces"},{name:"Tomates cerises",category:"Fruits & légumes",quantity:1,unit:"barquette"},{name:"Lait d’avoine",category:"Produits frais",quantity:2,unit:"briques"},{name:"Yaourts nature",category:"Produits frais",quantity:1,unit:"pack"},{name:"Pain de campagne",category:"Boulangerie",quantity:1,unit:"pièce",checked:true},{name:"Œufs plein air",category:"Produits frais",quantity:1,unit:"boîte",checked:true}].map((d,i)=>audit("i"+i,"item",{...d,listId:"s1"})),
    ...["Arroser les plantes","Prendre rendez-vous chez le dentiste","Réserver le week-end à Annecy","Récupérer le colis"].map((name,i)=>audit("t"+i,"item",{name,listId:"c1"})),
    ...["Passeports et billets","Chargeurs","Trousse de toilette"].map((name,i)=>audit("v"+i,"item",{name,listId:"c2",checked:i===0})),
    audit("n1","note",{name:"Le Wi-Fi de la maison",content:"Réseau : La maison\nLe mot de passe est sur la box, dans l’entrée.",color:"purple"}),
    audit("n2","note",{name:"Une idée pour le week-end",content:"Un pique-nique au bord du lac ?\nPenser à prendre les vélos et une couverture.",color:"yellow"}),
    audit("n3","note",{name:"La recette des pancakes",content:"250 g de farine · 2 œufs · 30 cl de lait\n1 sachet de levure · 30 g de sucre\nMélanger, laisser reposer puis cuire à feu doux.",color:"blue"}),
    audit("cat1","category",{name:"Artisans"}),audit("cat2","category",{name:"Plomberie",parentId:"cat1"}),audit("cat3","category",{name:"Électricité",parentId:"cat1"}),
    audit("co1","contact",{name:"Julien Martin",phone:"06 12 34 56 78",email:"julien@example.fr",address:"12 rue des Lilas, Lyon",categoryId:"cat2"}),
    audit("co2","contact",{name:"Électricité Durand",phone:"04 72 00 12 34",email:"contact@example.fr",address:"Lyon",categoryId:"cat3"}),
    audit("e1","electricity",{name:"Heures creuses de nuit",start:"22:00",end:"06:00",days:[0,1,2,3,4,5,6]}),
    audit("w1","waste",{name:"Bac recyclable",weekday:2,color:"#e3b544",reminder:"19:00",frequency:1}),
    audit("w2","waste",{name:"Ordures ménagères",weekday:5,color:"#789884",reminder:"19:00",frequency:1}),
    audit("p1","product",{name:"Lait d’avoine",category:"Produits frais",barcodes:["3017620422003"]}),
    audit("p2","product",{name:"Œufs plein air",category:"Produits frais",barcodes:[]}),
  ];
  return { user:{id:"demo",name:"Antoine",email:"antoine@example.fr"},household:{id:"demo",name:"Notre maison",code:"EXEMPLE",role:"admin"},households:[{id:"demo",name:"Notre maison",code:"EXEMPLE",role:"admin"}],entities,members:[{id:"demo",name:"Antoine",email:"antoine@example.fr",role:"admin"},{id:"demo2",name:"Camille",email:"camille@example.fr",role:"member"}],preferences:{shoppingId:"s1",checklistId:"c1",layout:"side",rotation:15,camera:"environment",peakColor:"#ffffff",offPeakColor:"#e7eeff"} };
}
