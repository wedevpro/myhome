"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowDownAZ, ArrowDownZA, ArrowUp, CircleCheck, Ellipsis, House, ListChecks, Pencil, Plus, RotateCcw, ScanBarcode, Search, ShoppingBasket, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Entity, Snapshot } from "@/lib/model";
import { completedItemsLast, filterChecklistItems, getChecklistItems, moveChecklistItem, sortChecklistItems } from "@/lib/checklist";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Choice } from "./entity-editor";

type Props = {
  list?: Entity;
  kind: "shopping" | "checklist";
  snapshot: Snapshot;
  busy: boolean;
  showPicker: boolean;
  onSelect: (id: string) => void;
  onAdd: (text: string) => Promise<void>;
  onToggle: (item: Entity) => Promise<void>;
  onDelete: (item: Entity) => void;
  onEditItem: (item: Entity) => void;
  onClearCompleted: (items: Entity[]) => void;
  onReorder: (itemIds: string[]) => Promise<void>;
  onScan: () => void;
  onNew: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onReset: () => void;
};

export default function ListPanel({ list, kind, snapshot, busy, showPicker, onSelect, onAdd, onToggle, onDelete, onEditItem, onClearCompleted, onReorder, onScan, onNew, onEdit, onRemove, onReset }: Props) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [moveTarget, setMoveTarget] = useState<{ id: string; position: string } | null>(null);
  const menuOpensDialog = useRef(false);
  const shopping = kind === "shopping";
  const items = completedItemsLast(shopping
    ? snapshot.entities.filter(item => item.kind === "item" && item.householdId === list?.householdId && item.data.listId === list?.id)
    : getChecklistItems(snapshot.entities, list));
  const visibleItems = shopping ? items : filterChecklistItems(items, query);
  const pending = items.filter(item => !item.data.checked).length;
  const completed = items.filter(item => item.data.checked);
  const canClearCompleted = shopping || !list?.data.reusable;
  const itemPositions = new Map(items.map((item, index) => [item.id, index]));
  const movingItem = items.find(item => item.id === moveTarget?.id);
  const firstPosition = movingItem?.data.checked ? pending + 1 : 1;
  const lastPosition = movingItem?.data.checked ? items.length : pending;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    try { await onAdd(text.trim()); setText(""); } catch {}
  };
  const reorder = async (itemIds: string[], message: string) => {
    if (itemIds.every((id, index) => id === items[index]?.id) && itemIds.length === items.length) return;
    await onReorder(itemIds);
    toast.success(message);
  };
  const sort = async (direction: "asc" | "desc") => {
    try {
      await reorder(completedItemsLast(sortChecklistItems(items, direction)).map(item => item.id), direction === "asc" ? "Checklist triée de A à Z" : "Checklist triée de Z à A");
    } catch {}
  };
  const move = async (item: Entity, direction: "up" | "down") => {
    const index = itemPositions.get(item.id) ?? -1;
    const adjacent = items[index + (direction === "up" ? -1 : 1)];
    if (!adjacent || !!adjacent.data.checked !== !!item.data.checked) return;
    try { await reorder(moveChecklistItem(items, item.id, direction), "Élément déplacé"); } catch {}
  };
  const moveToPosition = async (event: FormEvent) => {
    event.preventDefault();
    if (!moveTarget || !movingItem) return;
    const position = Number(moveTarget.position);
    if (!Number.isInteger(position) || position < firstPosition || position > lastPosition) return;
    const itemIds = items.filter(item => item.id !== moveTarget.id).map(item => item.id);
    itemIds.splice(position - 1, 0, moveTarget.id);
    try { await reorder(itemIds, `Élément déplacé à la position ${position}`); setMoveTarget(null); } catch {}
  };

  return (
    <section className={`panel ${shopping ? "shopping-panel" : "tasks-panel"}`}>
      <div className="panel-heading">
        <span className={`panel-icon ${shopping ? "green" : "coral"}`}>{shopping ? <ShoppingBasket size={21}/> : <ListChecks size={21}/>}</span>
        <div><h2>{shopping ? "Les courses" : "À faire"}</h2><p>{shopping ? "Tout ce qu’il nous faut." : "Une chose à la fois."}</p></div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="icon-button" disabled={busy} aria-label={shopping ? "Options des courses" : "Options des tâches"}><Ellipsis size={20}/></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNew}><Plus size={14}/>Nouvelle liste</DropdownMenuItem>
            {list && <>
              <DropdownMenuItem onClick={onEdit}><Pencil size={14}/>Nom et icône</DropdownMenuItem>
              {!shopping && list.data.reusable && <DropdownMenuItem onClick={onReset}><RotateCcw size={14}/>Tout décocher</DropdownMenuItem>}
              <DropdownMenuSeparator/>
              <DropdownMenuItem onClick={onRemove}><Trash2 size={14}/>Supprimer la liste</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {list ? <>
        <div className="list-toolbar">
          {showPicker
            ? <Choice label={shopping ? "Liste de courses affichée" : "Checklist affichée"} value={list.id} onChange={onSelect} options={snapshot.entities.filter(entity => entity.kind === kind).map(entity => ({ value: entity.id, label: String(entity.data.name) }))}/>
            : <span className="list-selector">{list.data.name}</span>}
          {shopping && <span className="counter">{pending} à acheter</span>}
        </div>
        <div className="list-entry-controls">
          <form className={shopping ? "add-item" : "add-item add-task"} onSubmit={add}>
            <Plus size={18}/>
            {shopping ? <Combobox items={snapshot.entities.filter(entity => entity.kind === "product").map(entity => String(entity.data.name))} inputValue={text} onInputValueChange={setText} onValueChange={value => { if (typeof value === "string") setText(value); }}>
              <ComboboxInput disabled={busy} showTrigger={false} placeholder="Ajouter un produit…" aria-label="Ajouter un produit" className="flex-1 border-none bg-transparent shadow-none"/>
              <ComboboxContent><ComboboxEmpty>Saisissez un nouveau produit puis validez.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
            </Combobox> : <input placeholder="Ajouter une tâche…" aria-label="Ajouter une tâche" disabled={busy} value={text} onChange={event => setText(event.target.value)} maxLength={150}/>}
            <button type="submit" disabled={busy || !text.trim()} aria-label={shopping ? "Ajouter le produit" : "Ajouter la tâche"}><Plus size={18}/></button>
          </form>
          {shopping && <button type="button" className="scan-button" disabled={busy} onClick={onScan}><ScanBarcode size={19}/>Scanner un code-barres</button>}
          {canClearCompleted && <button type="button" className="secondary-button clear-completed-button" disabled={busy || completed.length === 0} onClick={() => onClearCompleted(completed)}><Trash2 size={15}/>Supprimer les éléments terminés ({completed.length})</button>}
        </div>
        {!shopping && <>
          <div className="checklist-controls">
            <div className="checklist-filter">
              <Search size={16} aria-hidden="true"/>
              <input type="search" aria-label={`Filtrer les éléments de ${list.data.name}`} placeholder="Filtrer les éléments…" value={query} onChange={event => setQuery(event.target.value)} maxLength={150}/>
              {query && <button type="button" className="icon-button" aria-label="Effacer le filtre" onClick={() => setQuery("")}><X size={15}/></button>}
            </div>
            <div className="checklist-sort">
              <button type="button" className="secondary-button" disabled={busy || items.length < 2} onClick={() => void sort("asc")} aria-label="Trier la checklist de A à Z" title="Trier toute la checklist de A à Z"><ArrowDownAZ size={16}/>A–Z</button>
              <button type="button" className="secondary-button" disabled={busy || items.length < 2} onClick={() => void sort("desc")} aria-label="Trier la checklist de Z à A" title="Trier toute la checklist de Z à A"><ArrowDownZA size={16}/>Z–A</button>
            </div>
          </div>
          <div className="checklist-filter-info" role="status" aria-live="polite">
            <span>{visibleItems.length} / {items.length} élément{items.length > 1 ? "s" : ""}</span>
            {query.trim() && <span>Le tri et les positions concernent toute la liste.</span>}
          </div>
          <p className="helper checklist-order-help">Le menu ⋯ de chaque élément permet de le renommer ou le déplacer. Les éléments cochés restent en bas.</p>
          <div className="progress-label"><span>{list.data.reusable ? "Prêts pour la prochaine fois" : "On avance à notre rythme"}</span><span>{items.length - pending} / {items.length}</span></div>
          <Progress value={items.length ? (items.length - pending) / items.length * 100 : 0} className="h-1 bg-[#f5f0ed] [&_[data-slot=progress-indicator]]:bg-[#e6bba3]"/>
        </>}
        <div className={shopping ? "shopping-items" : "task-items"} role="region" aria-label={`Éléments de ${list.data.name}`} tabIndex={0}>
          {visibleItems.map(item => {
            const index = itemPositions.get(item.id) ?? 0;
            return <div key={item.id} className={`item-row ${item.data.checked ? "completed" : ""}`}>
              <Checkbox checked={!!item.data.checked} disabled={busy} onCheckedChange={() => void onToggle(item).catch(() => {})} aria-label={(shopping ? "Acheter " : "Terminer ") + item.data.name}/>
              <div className="item-label"><span>{item.data.name}</span>{shopping && !item.data.checked && item.data.category && <small>{item.data.category}</small>}{shopping && item.data.comment && <p className="shopping-item-comment">{item.data.comment}</p>}</div>
              {shopping ? <>
                <button type="button" className="quantity quantity-button" disabled={busy} aria-label={`Modifier la quantité de ${item.data.name}`} title="Modifier la quantité et la note" onClick={() => onEditItem(item)}>{item.data.quantity ?? 1} {item.data.unit || ""}</button>
                <button type="button" className="icon-button shopping-item-edit" disabled={busy} aria-label={`Modifier la quantité et la note de ${item.data.name}`} title="Modifier cet article" onClick={() => onEditItem(item)}><Pencil size={15}/></button>
              </> : <DropdownMenu onOpenChange={open => { if (open) menuOpensDialog.current = false; }}>
                <DropdownMenuTrigger asChild><button type="button" className="icon-button checklist-actions-trigger" disabled={busy} aria-label={`Actions pour ${item.data.name}, position ${index + 1}`} title="Actions de cet élément"><Ellipsis size={19}/></button></DropdownMenuTrigger>
                <DropdownMenuContent className="checklist-actions-menu" align="end" onCloseAutoFocus={event => { if (menuOpensDialog.current) { event.preventDefault(); menuOpensDialog.current = false; } }}>
                  <DropdownMenuItem onSelect={() => { menuOpensDialog.current = true; onEditItem(item); }}><Pencil size={15}/>Modifier le libellé</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem disabled={index === 0 || !!items[index - 1]?.data.checked !== !!item.data.checked} onSelect={() => void move(item, "up")}><ArrowUp size={15}/>Monter d’une position</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { menuOpensDialog.current = true; setMoveTarget({ id: item.id, position: String(index + 1) }); }}><ListChecks size={15}/>Choisir la position ({index + 1})</DropdownMenuItem>
                  <DropdownMenuItem disabled={index === items.length - 1 || !!items[index + 1]?.data.checked !== !!item.data.checked} onSelect={() => void move(item, "down")}><ArrowDown size={15}/>Descendre d’une position</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}><Trash2 size={15}/>Supprimer cet élément</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
              {shopping && <button type="button" className="icon-button item-delete" disabled={busy} aria-label={"Retirer " + item.data.name} onClick={() => onDelete(item)}><X size={13}/></button>}
            </div>;
          })}
          {items.length === 0 && <p className="helper py-7 text-center">{shopping ? "Votre liste est prête à accueillir les courses." : "Rien à faire pour le moment. Profitez-en."}</p>}
          {!shopping && items.length > 0 && visibleItems.length === 0 && <div className="checklist-no-results"><p className="helper">Aucun élément ne correspond au filtre.</p><button type="button" className="secondary-button" onClick={() => setQuery("")}>Afficher tous les éléments</button></div>}
        </div>
        {!shopping && <div className="task-tip"><CircleCheck size={19}/><span>{list.data.reusable ? "Votre liste reste là pour une prochaine fois." : "Supprimez les éléments terminés quand vous le souhaitez."}</span></div>}
        <footer className="panel-footer">
          <span>{shopping ? "Partagée avec le foyer" : list.data.reusable ? "Liste réutilisable" : "Liste éphémère"}</span>
          {shopping ? <div className="avatar-stack">{snapshot.members.slice(0, 3).map(member => <span key={member.id}>{member.name.slice(0, 1).toUpperCase()}</span>)}</div> : <span>{pending} tâche{pending > 1 ? "s" : ""} à faire</span>}
        </footer>
      </> : <div className="empty-state"><House size={30}/><h3>Une place pour l’essentiel.</h3><p>{shopping ? "Créez votre première liste de courses." : "Créez une checklist pour votre quotidien."}</p><button className="primary-button" onClick={onNew}><Plus size={15}/>Créer une liste</button></div>}
      <Dialog open={!!moveTarget} onOpenChange={open => { if (!open) setMoveTarget(null); }}>
        <DialogContent className="bg-background sm:max-w-[420px]">
          <DialogTitle>Déplacer un élément</DialogTitle>
          <DialogDescription>{movingItem ? `Choisissez la position de « ${movingItem.data.name} ». Les éléments cochés restent regroupés en bas.` : "Cet élément n’est plus dans la checklist."}</DialogDescription>
          {movingItem && <form className="form-stack" onSubmit={moveToPosition}>
            <label className="field">Nouvelle position<input type="number" autoFocus required disabled={busy} min={firstPosition} max={lastPosition} step={1} value={moveTarget?.position ?? ""} onChange={event => setMoveTarget(target => target ? { ...target, position: event.target.value } : null)}/></label>
            <p className="helper">De {firstPosition} à {lastPosition}, parmi les éléments {movingItem.data.checked ? "terminés" : "à faire"}. Position actuelle : {(itemPositions.get(movingItem.id) ?? 0) + 1}.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMoveTarget(null)}>Annuler</button><button type="submit" className="primary-button" disabled={busy}>Déplacer</button></div>
          </form>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
