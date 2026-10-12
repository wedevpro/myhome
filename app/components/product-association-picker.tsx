"use client";

import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Entity } from "@/lib/model";
import { findProductByName, findProductsByName, normalizeProductName } from "@/lib/product-matching";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

type ProductAssociationPickerProps = {
  products: Entity[];
  name: string;
  onNameChange: (name: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
};

export default function ProductAssociationPicker({ products, name, onNameChange, selectedId, onSelect, disabled = false }: ProductAssociationPickerProps) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const portalContainer = useRef<HTMLDivElement>(null);
  const selected = products.find(product => product.id === selectedId) || null;
  const exactMatches = findProductsByName(products, name);
  const exactMatch = findProductByName(products, name);
  const missingSelected = !!selectedId && !selected;
  const ambiguousName = !selectedId && exactMatches.length > 1;

  const editName = (value: string) => { onNameChange(value); onSelect(""); };

  return (
    <div ref={portalContainer} className="flex flex-col gap-1.5">
      <label className="field" htmlFor={inputId}>Nom du produit</label>
      <Combobox<Entity>
        items={products}
        value={selected}
        inputValue={name}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        itemToStringLabel={product => product.data.name || ""}
        itemToStringValue={product => product.id}
        isItemEqualToValue={(item, value) => item.id === value.id}
        filter={(product, query) => normalizeProductName(product.data.name || "").includes(normalizeProductName(query))}
        onInputValueChange={(value, details) => {
          if (details.reason === "input-change" || details.reason === "clear-press") editName(value);
          else if (details.reason === "item-press") onNameChange(value);
          // Single Combobox also requests input-clear/none when closing its
          // popup. Retain free text and an explicit ID on those updates.
        }}
        onValueChange={(product, details) => {
          if (details.reason === "item-press" && product) {
            onNameChange(product.data.name || "");
            onSelect(product.id);
          } else if (details.reason === "clear-press") editName("");
        }}
      >
        <div className="flex items-center gap-2">
          <ComboboxInput
            id={inputId}
            ref={inputRef}
            autoFocus
            required
            maxLength={150}
            disabled={disabled}
            showTrigger={false}
            className="min-w-0 flex-1"
            placeholder="Rechercher ou saisir un nouveau produit…"
            aria-label="Nom du produit"
            aria-describedby={statusId}
            aria-invalid={missingSelected || ambiguousName || undefined}
          />
          {name && <button type="button" className="icon-button" disabled={disabled} aria-label="Effacer le nom du produit" onClick={() => { editName(""); inputRef.current?.focus(); }}><X size={16} aria-hidden="true"/></button>}
        </div>
        <ComboboxContent portalContainer={portalContainer}>
          <ComboboxEmpty>Saisissez un nouveau nom puis validez pour créer le produit.</ComboboxEmpty>
          <ComboboxList>{(product: Entity) => <ComboboxItem key={product.id} value={product}><span className="flex min-w-0 flex-col"><span>{product.data.name}</span>{(product.data.category || product.data.barcodes?.[0]) && <small className="text-muted-foreground">{[product.data.category, product.data.barcodes?.[0]].filter(Boolean).join(" · ")}</small>}</span></ComboboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p id={statusId} role="status" className={missingSelected || ambiguousName ? "error-text" : "helper"}>
        {missingSelected ? "Le produit sélectionné n’est plus dans le catalogue. Choisissez une autre suggestion ou modifiez le nom pour créer un produit." : ambiguousName ? "Plusieurs produits portent ce nom. Choisissez le produit à associer dans les suggestions." : selected ? `Ce code sera associé à « ${selected.data.name} ».` : exactMatch ? "Ce produit existe déjà dans le catalogue : son code-barres sera ajouté à sa fiche." : "Choisissez un produit proposé ou saisissez le nom d’un nouveau produit."}
      </p>
    </div>
  );
}
