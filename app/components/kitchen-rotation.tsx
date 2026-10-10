"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getSwipeDirection } from "@/lib/kitchen-rotation";

export default function KitchenRotation({ children, count, index, onChange, onActivity }: {
  children: ReactNode;
  count: number;
  index: number;
  onChange: (direction: -1 | 1) => void;
  onActivity: () => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; startedAt: number } | null>(null);

  const start = (event: TouchEvent<HTMLDivElement>) => {
    gesture.current = null;
    if (count < 2 || event.touches.length !== 1) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button,a,input,textarea,select,[role="checkbox"],[role="combobox"],[role="menu"]')) return;
    const touch = event.touches[0];
    gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, startedAt: performance.now() };
  };
  const end = (event: TouchEvent<HTMLDivElement>) => {
    onActivity();
    const started = gesture.current;
    gesture.current = null;
    if (!started || event.touches.length) return;
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === started.id);
    if (!touch) return;
    const direction = getSwipeDirection({ dx: touch.clientX - started.x, dy: touch.clientY - started.y, durationMs: performance.now() - started.startedAt });
    if (direction) onChange(direction);
  };

  const move = (event: TouchEvent<HTMLDivElement>) => {
    onActivity();
    if (event.touches.length !== 1) { gesture.current = null; return; }
    const started = gesture.current;
    if (!started) return;
    const touch = event.touches[0];
    // A vertical scroll must stay a scroll even if the finger later moves sideways.
    const dx = Math.abs(touch.clientX - started.x), dy = Math.abs(touch.clientY - started.y);
    if (dy > 12 && dy > dx) gesture.current = null;
  };

  return <div className="kitchen-rotation" onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={() => { gesture.current = null; onActivity(); }} onPointerDownCapture={onActivity} onKeyDownCapture={onActivity} onInputCapture={onActivity} onScrollCapture={onActivity} onBlurCapture={onActivity}>
    {count > 1 && <nav className="rotation-navigation" aria-label="Rotation des listes">
      <button type="button" className="secondary-button" onClick={() => onChange(-1)} aria-label="Afficher la liste précédente"><ArrowLeft size={20}/></button>
      <span>Balayez pour changer de liste <small>{index + 1} / {count}</small></span>
      <button type="button" className="secondary-button" onClick={() => onChange(1)} aria-label="Afficher la liste suivante"><ArrowRight size={20}/></button>
    </nav>}
    {children}
  </div>;
}
