"use client";

import { useMemo } from "react";
import { getNextElectricityTransition, type Entity } from "@/lib/model";

const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });

export default function ElectricityTransition({ entities, now }: { entities: Entity[]; now: Date }) {
  const rules = useMemo(() => entities.filter(entity => entity.kind === "electricity"), [entities]);
  const next = useMemo(() => getNextElectricityTransition(rules, now), [rules, now]);
  if (!rules.length) return null;
  if (!next) return <p className="electricity-transition">Aucun changement prévu</p>;

  const today = dateKey.format(now), nextDay = dateKey.format(next.at);
  // Midday UTC the following date avoids a 23/25-hour day around a clock change.
  const tomorrow = dateKey.format(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000);
  const when = nextDay === today ? "" : nextDay === tomorrow ? "demain " : `${dayLabel.format(next.at)} `;
  const minutes = next.minutesRemaining;
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  const remaining = days ? `${days} j${hours ? ` ${hours} h` : ""}` : hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${minutes} min`;

  return <p className="electricity-transition"><strong>{next.offPeak ? "Heures creuses" : "Heures pleines"} {when}à {clock.format(next.at)}</strong><br/>Dans {remaining}</p>;
}
