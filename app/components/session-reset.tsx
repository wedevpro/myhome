"use client";

import { useState } from "react";

export default function SessionReset() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverUnavailable, setServerUnavailable] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    setServerUnavailable(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: unknown } | null;
        setServerUnavailable(response.status >= 500);
        setError(typeof result?.error === "string" ? result.error : "La déconnexion a échoué. Réessayez dans quelques instants.");
        return;
      }
      window.location.replace("/connexion");
    } catch (cause) {
      console.error("MyHomeIA logout request failed", cause);
      setServerUnavailable(true);
      setError("Le serveur est injoignable ou ne répond pas. Réessayez après son redémarrage.");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#f7f8fc]">
      <section className="management-card settings-section w-full max-w-md">
        <p className="mb-8 font-semibold text-xl text-[#7761d5]">MyHomeIA</p>
        <h1 className="text-2xl font-semibold mb-3">Fermer votre session</h1>
        <p className="helper mb-7">Vous pouvez vous déconnecter ici lorsque le tableau de bord ne s'affiche plus, puis retrouver la page de connexion.</p>
        <button type="button" className="primary-button w-full" onClick={() => void logout()} disabled={busy} aria-busy={busy}>
          {busy ? "Déconnexion en cours…" : "Se déconnecter"}
        </button>
        {error && <p className="error-text mt-5" role="alert">{error}</p>}
        {serverUnavailable && <p className="helper mt-4">Si le serveur reste indisponible, supprimez les cookies de ce site dans les paramètres de votre navigateur. Revenez ensuite à la page de connexion lorsque le serveur répond.</p>}
      </section>
    </main>
  );
}
