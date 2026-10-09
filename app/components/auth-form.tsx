"use client";
import { useState } from "react";
import { House, ArrowLeft } from "lucide-react";

export default function AuthForm({ signup = false }: { signup?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <main className="min-h-screen flex items-center justify-center p-6 bg-[#f7f8fc]">
    <section className="management-card settings-section w-full max-w-md">
      <a href="/" className="flex items-center gap-3 mb-8 font-semibold text-xl text-[#7761d5]"><House size={28}/>MyHomeIA</a>
      <h1 className="text-2xl font-semibold mb-3">{signup ? "Bienvenue chez vous." : "Retrouvez votre foyer."}</h1>
      <p className="helper mb-7">{signup ? "Créez votre compte, puis créez un foyer ou rejoignez celui de vos proches." : "Connectez-vous avec le compte de votre installation MyHomeIA."}</p>
      <form className="form-stack" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          const response = await fetch(`/api/auth/${signup ? "signup" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error || "La connexion a échoué.");
          window.location.assign("/");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "La connexion est indisponible."); setBusy(false); }
      }}>
        {signup && <label className="field">Votre nom<input name="name" required autoComplete="name" maxLength={100} placeholder="Antoine" disabled={busy}/></label>}
        <label className="field">Adresse e-mail<input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="vous@exemple.fr" disabled={busy}/></label>
        <label className="field">Mot de passe<input name="password" type="password" required autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : 1} maxLength={256} disabled={busy}/></label>
        {signup && <p className="helper">Au moins 12 caractères. Une phrase facile à retenir convient très bien.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Veuillez patienter…" : signup ? "Créer mon compte" : "Se connecter"}</button>
      </form>
      <p className="helper mt-6">{signup ? "Vous avez déjà un compte ? " : "Première visite ? "}<a className="text-[#7761d5] font-medium" href={signup ? "/connexion" : "/inscription"}>{signup ? "Se connecter" : "Créer un compte"}</a></p>
      <a href="/" className="flex items-center gap-2 helper mt-5"><ArrowLeft size={14}/>Explorer le foyer d’exemple</a>
    </section>
  </main>;
}
