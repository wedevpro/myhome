import { Carrot, Heart, House, ListChecks, Plane, ShoppingBag, ShoppingBasket } from "lucide-react";
import type { Entity } from "@/lib/model";

const icons = { basket: ShoppingBasket, home: House, carrot: Carrot, plane: Plane, check: ListChecks, heart: Heart, bag: ShoppingBag };

export default function ListIcon({ entity, size = 22 }: { entity: Entity; size?: number }) {
  const fallback = entity.kind === "checklist" ? ListChecks : ShoppingBasket;
  const Icon = Object.hasOwn(icons, entity.data.icon ?? "") ? icons[entity.data.icon as keyof typeof icons] : fallback;
  return <Icon size={size} aria-hidden="true"/>;
}
