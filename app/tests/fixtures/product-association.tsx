"use client";

import { useState } from "react";
import { createRoot } from "react-dom/client";
import ProductAssociationPicker from "@/components/product-association-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Entity } from "@/lib/model";

const products: Entity[] = Array.from({ length: 100 }, (_, index) => ({
  id: `fixture-product-${String(index).padStart(3, "0")}`,
  kind: "product",
  householdId: "fixture-household",
  revision: `fixture-revision-${index}`,
  createdBy: "fixture-user",
  updatedBy: "fixture-user",
  createdAt: "2026-10-12T12:00:00.000Z",
  updatedAt: "2026-10-12T12:00:00.000Z",
  data: {
    name: `Produit ${String(index).padStart(3, "0")} Famille ${Math.floor(index / 20)}`,
    category: `Rayon ${index % 7}`,
    barcodes: [`390000000${String(index).padStart(4, "0")}`],
  },
}));

function Fixture() {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selections, setSelections] = useState<unknown[]>([]);
  const [submissions, setSubmissions] = useState(0);
  const collision = new URLSearchParams(location.search).has("collision");
  return (
    <Dialog open>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-background sm:max-w-[520px]" data-test="fixture-dialog">
        <DialogTitle>Association d’un code-barres inconnu</DialogTitle>
        <DialogDescription>Fixture isolée avec le composant de production et 100 produits distincts.</DialogDescription>
        <form className="form-stack" onSubmit={event => { event.preventDefault(); setSubmissions(previous => previous + 1); }}>
          {collision && <div style={{ height: 480, flexShrink: 0 }} data-test="dialog-scroll-spacer">Informations au-dessus du champ dans une fenêtre défilante.</div>}
          <ProductAssociationPicker products={products} name={name} selectedId={selectedId} onNameChange={setName} onSelect={id => {
            const events = (window as unknown as { __pointerLog?: unknown[] }).__pointerLog;
            setSelections(previous => [...previous, { id, event: events?.at(-1) }]);
            setSelectedId(id);
          }}/>
          <label className="field">Quantité<input type="number" defaultValue={1}/></label>
          <button type="submit" className="primary-button">Ajouter à la liste</button>
          <output data-test="selected-id">{selectedId}</output>
          <output data-test="selected-name">{name}</output>
          <output data-test="selection-trace" style={{ display: "none" }}>{JSON.stringify(selections)}</output>
          <output data-test="submissions" style={{ display: "none" }}>{submissions}</output>
          {collision && <div style={{ height: 240, flexShrink: 0 }}>Autres champs de la fenêtre défilante.</div>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture/>);
