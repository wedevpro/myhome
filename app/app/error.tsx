"use client";

import { useEffect } from "react";

export default function ApplicationError({ error, retry, reset }: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset: () => void;
}) {
  useEffect(() => { console.error("MyHomeIA page error", error); }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#f7f8fc]">
      <section className="management-card settings-section w-full max-w-md">
        <p className="mb-8 font-semibold text-xl text-[#7761d5]">MyHomeIA</p>
        <h1 className="text-2xl font-semibold mb-3">La page n'a pas pu s'afficher</h1>
        <p className="helper mb-7">Une erreur empêche l'affichage de cette page. Réessayez ; si elle persiste, vous pouvez fermer votre session depuis la page de déconnexion.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="primary-button" onClick={() => (retry || reset)()}>Réessayer</button>
          <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Recharger la page</button>
          <a className="secondary-button" href="/deconnexion">Se déconnecter</a>
        </div>
        {error.digest && <p className="helper mt-5">Référence de l'erreur : {error.digest}</p>}
      </section>
    </main>
  );
}
