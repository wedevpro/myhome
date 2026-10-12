"use client";

import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Entity } from "@/lib/model";
import { Choice } from "./entity-editor";

type ProductAssociationPickerProps = {
  products: Entity[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function searchableName(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
}

export default function ProductAssociationPicker({ products, value, onChange, disabled = false }: ProductAssociationPickerProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const resultId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const search = searchableName(query);
  const matches = products.filter(product => searchableName(product.data.name || "").includes(search));
  const selected = products.find(product => product.id === value);
  const selectedOutsideSearch = !!selected && !matches.some(product => product.id === value);
  const selectedUnavailable = !!value && !selected;
  // Retain the selected item in Select so filtering never clears its label or
  // silently changes the association. The count still includes matches only.
  const retainedSelection = value && !matches.some(product => product.id === value)
    ? [{ value, label: selected ? `${selected.data.name} — sélectionné, hors recherche` : "Produit sélectionné indisponible" }]
    : [];
  const options = [
    { value: "", label: "Créer un nouveau produit" },
    ...retainedSelection,
    ...matches.map(product => ({ value: product.id, label: product.data.name || "Sans nom" })),
  ];

  return (
    <div className="form-stack">
      <div className="field">
        <label htmlFor={searchId}>Rechercher un produit existant</label>
        <div className="flex items-center gap-2">
          <input
            id={searchId}
            ref={searchInput}
            type="search"
            autoFocus
            className="min-w-0 flex-1"
            placeholder="Nom du produit…"
            value={query}
            disabled={disabled}
            maxLength={150}
            aria-describedby={resultId}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
          />
          {query && <button type="button" className="icon-button" disabled={disabled} aria-label="Effacer la recherche de produit" onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X size={16} aria-hidden="true"/></button>}
        </div>
      </div>
      <p className="helper" id={resultId} role="status" aria-live="polite">
        {matches.length ? `${matches.length} produit${matches.length > 1 ? "s" : ""} trouvé${matches.length > 1 ? "s" : ""}.` : search ? "Aucun produit ne correspond à votre recherche." : "Aucun produit existant dans le catalogue."}
      </p>
      <div className="field">
        <span>Associer à un produit existant</span>
        <Choice label="Produit à associer" value={value} onChange={onChange} options={options} disabled={disabled}/>
      </div>
      {selectedOutsideSearch && <p className="helper">« {selected.data.name} » reste sélectionné et ne correspond pas à cette recherche.</p>}
      {selectedUnavailable && <p className="error-text" role="status">Le produit sélectionné n’est plus dans le catalogue. Choisissez un autre produit ou créez-en un nouveau.</p>}
    </div>
  );
}
