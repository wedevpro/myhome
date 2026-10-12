import type { Entity } from "./model";

/** Use the same exact-name comparison for barcode association on client and server. */
export function normalizeProductName(name: string): string {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
}

/** Callers supply the active household's catalogue; partial names never match. */
export function findProductsByName(products: Entity[], name: string): Entity[] {
  const normalized = normalizeProductName(name);
  if (!normalized) return [];
  return products.filter(product => product.kind === "product"
    && normalizeProductName(product.data.name || "") === normalized);
}

/** A typed name is resolved only when it identifies exactly one catalogue entry. */
export function findProductByName(products: Entity[], name: string): Entity | undefined {
  const matches = findProductsByName(products, name);
  return matches.length === 1 ? matches[0] : undefined;
}
