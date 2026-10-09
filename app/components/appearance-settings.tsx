"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <section className="management-card settings-section form-stack">
      <h3>Apparence</h3>
      <label className="field" htmlFor="appearance-mode">
        Mode d’affichage
        <select
          id="appearance-mode"
          value={mounted ? theme || "light" : "light"}
          disabled={!mounted}
          onChange={event => setTheme(event.target.value)}
          aria-describedby="appearance-help"
        >
          <option value="light">Mode Clair</option>
          <option value="dark">Mode Sombre</option>
          <option value="system">Appliquer le mode de l’appareil</option>
        </select>
      </label>
      <p className="helper" id="appearance-help">
        Le changement est immédiat et mémorisé sur cet appareil. Le mode clair
        s’applique par défaut ; le mode de l’appareil suit ses changements
        d’apparence.
      </p>
    </section>
  );
}
