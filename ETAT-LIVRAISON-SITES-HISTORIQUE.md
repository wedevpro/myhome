# État de livraison — MyHomeIA

9 octobre 2026, Europe/Paris.

## Application locale

Code dans `app/`. Serveur de développement actif sur **http://127.0.0.1:5173/**. Une version Node.js compatible est conservée dans `.runtime/` ; l’installation existante de l’ordinateur n’a pas été remplacée.

Sans connexion, l’application affiche un foyer d’exemple dont les modifications sont temporaires. Pour utiliser la base locale, cliquer sur « Créer mon foyer » : l’environnement de développement utilise l’identité locale `Seedy`. Les foyers créés par les tests API sont uniquement dans cette base de développement. La production utilise la connexion ChatGPT et ne contient pas cette simulation.

Modules présents : listes de courses, produits et codes-barres, scan caméra avant/arrière et douchette clavier, checklists éphémères ou réutilisables, notes texte, contacts et hiérarchie de catégories, heures pleines/creuses, sorties de poubelles, mode cuisine et préférences personnelles, foyers et rôles administrateur/utilisateur, traçabilité serveur.

Synchronisation : actualisation toutes les **2,5 secondes** lorsque l’application est visible, après les modifications et au retour sur la fenêtre. Ce n’est pas un flux instantané Firebase ou WebSocket.

Documentation détaillée : [app/README.md](app/README.md) et [app/docs/ARCHITECTURE.md](app/docs/ARCHITECTURE.md).

## Vérifications réussies

- Compilation TypeScript sans erreur.
- Compilation de production du Worker et des assets réussie.
- Sept tests de domaine et contraintes SQLite réussis : heures traversant minuit, changement d’heure, récurrence des poubelles, isolation des foyers, références orphelines, cycles de catégories, droits et codes-barres.
- Test d’intégration API réussi : connexion, création du foyer, catalogue, scan connu/inconnu, persistance, rejet d’une révision obsolète, protection du dernier administrateur, préférences et suppression d’une liste avec ses éléments.
- Requête HTTP de la page d’accueil : 200.

Le navigateur de vérification intégré était indisponible (`sandboxPolicy` manquant). Le rendu visuel, les scans sur matériel et la réception Push n’ont pas été vérifiés sur des appareils réels. La validation WebMCP dans un navigateur compatible reste indisponible.

## Publication : bloquée

L’archive a été créée et envoyée. La source correspondante a été enregistrée dans le dépôt privé du Site. **Aucune URL en ligne active n’a été délivrée.**

| Référence | Valeur |
| --- | --- |
| Site | `appgprj_6ac8a886a1e88191bcfe92447835dd1c` |
| Version enregistrée | `appgprj_6ac8a886a1e88191bcfe92447835dd1c~appgver_775cd304b0888191af346c482e4f137e` |
| Déploiement échoué | `appgdep_6ac8b605e3e48191b5fb230b16362184` |
| Commit source | `1020bb8385e607900751cd64b0ff2219c1e27fdb` |
| Archive | `D:/Projets/MyHomeIA/myhomeia-site.tar.gz` |
| Erreur exacte | `incomplete input: SQLITE_ERROR` |
| Échec enregistré | 9 octobre 2026 à 11:38:21, Europe/Paris |

L’échec intervient à l’application des migrations distantes. Les triggers SQLite sont une cause possible, mais le message ne désigne pas la migration concernée et la consultation du stockage distant ne retourne aucune liaison accessible. Les mêmes migrations s’exécutent correctement dans SQLite local et dans l’émulation D1 locale. Il n’est pas possible de déterminer sûrement quelles migrations ont déjà été appliquées en production.

La règle [Sites — Persistence and storage](C:/Users/Antoine/.codex/plugins/cache/openai-curated-remote/sites/0.1.75/skills/sites-building/references/persistence-and-storage.md) impose : “If the applied/unapplied boundary is uncertain, stop instead of rewriting history or retrying the same archive.” Les migrations existantes n’ont donc pas été réécrites après cet échec, et la même archive n’a pas été redéployée.

## Activations restantes

1. Diagnostiquer l’état des migrations distantes et terminer l’hébergement HTTPS.
2. Autoriser les autres membres au niveau de l’hébergement, en plus de leurs adhésions applicatives. L’audience du Site est restée privée pour le propriétaire.
3. Configurer un planificateur serveur pour les rappels automatiques lorsque l’application est fermée. Le service worker, les abonnements, VAPID, l’envoi de test, l’endpoint protégé et le handler `scheduled` sont implémentés. Aucun planificateur n’a été activé.
4. Vérifier les caméras, la douchette HID, le mode cuisine et les notifications sur les appareils du foyer.

Le code et l’application locale constituent une première version utilisable pour revue. L’usage familial en production n’est pas encore opérationnel.
