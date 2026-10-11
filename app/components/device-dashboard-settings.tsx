"use client";

import { Switch } from "@/components/ui/switch";
import { useDeviceDashboard } from "@/hooks/use-device-dashboard";

export default function DeviceDashboardSettings() {
  const { settings, setVisibility, hydrated } = useDeviceDashboard();

  return <section className="management-card settings-section form-stack">
    <h3>Tableau de bord sur cet appareil</h3>
    <p className="helper" id="device-dashboard-help">Ces choix s’appliquent immédiatement et sont mémorisés dans ce navigateur, pour le tableau de bord classique et le mode cuisine.</p>
    <div className="device-card-option">
      <label htmlFor="device-show-electricity">Afficher la carte électricité</label>
      <Switch id="device-show-electricity" checked={settings.showElectricity} disabled={!hydrated} onCheckedChange={value => setVisibility("showElectricity", value)} aria-describedby="device-dashboard-help"/>
    </div>
    <div className="device-card-option">
      <label htmlFor="device-show-waste">Afficher la carte poubelles</label>
      <Switch id="device-show-waste" checked={settings.showWaste} disabled={!hydrated} onCheckedChange={value => setVisibility("showWaste", value)} aria-describedby="device-dashboard-help"/>
    </div>
  </section>;
}
