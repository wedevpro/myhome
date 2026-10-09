# État de livraison — MyHomeIA sur Synology

9 octobre 2026, Europe/Paris. Cible : **DS920+, DSM 7.4.1-90080**, Container Manager, Linux amd64.

## Correctif après connexion

Le blocage signalé après inscription/connexion a été reproduit sur le serveur de production : l'API authentifiait le compte, mais le rendu de `/` échouait avec « Only plain objects ... Classes or null prototypes are not supported ». SQLite renvoyait un objet utilisateur avec un prototype null, refusé par React lorsqu'il était passé au composant client.

Les résultats de l'adaptateur SQLite sont maintenant convertis en objets ordinaires. Une page `/deconnexion` indépendante de la lecture du compte permet de fermer une session en cas de panne du tableau de bord ; une page d'erreur en français donne accès à cette récupération.

La nouvelle archive remplace la précédente sous le même nom. Sur le NAS, conservez `data/` et `.env`, remplacez les sources et reconstruisez/recréez le conteneur. Aucun schéma, mot de passe ou compte existant n'est modifié par ce correctif.

Le guide de mise à jour récupère maintenant le nom de projet Compose enregistré sur le conteneur avant de lancer la commande SSH avec `-p`. Cette procédure évite le conflit de nom avec un conteneur créé par Container Manager sous un autre nom de projet, sans suppression manuelle du conteneur.

## Fichiers à copier

Décompressez **`myhomeia-synology.zip`** dans `/volume1/docker/myhomeia/`. Le package contient les sources nécessaires, `Dockerfile`, `docker-compose.yml`, les modèles de configuration et le [guide d'installation](GUIDE-SYNOLOGY.md). Le NAS construit lui-même l'image Linux ; ce ZIP n'est ni une image Docker précompilée ni un paquet SPK.

Le fichier `myhomeia-synology.zip.sha256` permet de vérifier l'intégrité de l'archive. `PREPARER-PACKAGE.ps1` permet de la recréer depuis les sources du workspace.

Configurez `.env` à partir du modèle racine, préparez `data/` pour l'UID/GID 1000, créez le projet Container Manager et configurez le proxy HTTPS de DSM. L'application écoute sur `127.0.0.1:3080` du NAS ; son accès passe par l'adresse HTTPS configurée.

## Version autonome

- Next.js en production sur Node.js 24 dans le conteneur, avec SQLite natif.
- Comptes MyHomeIA par email/mot de passe ; inscription, connexion, déconnexion et sessions persistantes. Aucun compte ChatGPT requis.
- Base, comptes, abonnements et clés Push conservés dans `data/myhomeia.sqlite`.
- Migrations appliquées au démarrage dans des transactions, avec contrôle des checksums.
- Planificateur de rappels supervisé avec le serveur, vérification chaque minute ; aucun cron externe à configurer.
- Modules courses/produits/codes-barres, checklists, notes texte, contacts, électricité, poubelles, tableau de bord personnel et foyers conservés.

La synchronisation reste une actualisation toutes les **2,5 secondes**, après modification et au retour sur la page. Les notes sont en texte simple. L'archive exclut les dépendances Windows, bases de développement, secrets et anciens fichiers de publication Sites.

## Validation

- Installation propre des dépendances depuis le lockfile : réussie, 552 packages.
- Compilation Next.js de production et génération du worker de rappels : réussies.
- Validation Docker Compose : réussie.
- Tests de domaine, authentification, SQLite et rappels : **20 tests réussis** (7 domaine, 5 authentification, 7 stockage NAS, 1 rappels avec plusieurs scénarios).
- Intégration sur serveur de production : affichage du tableau de bord authentifié après inscription, connexion et redémarrage ; accès à `/deconnexion` ; partage et isolation des foyers, rôles, codes-barres, conflits, préférences, contrôle d'origine et persistance : réussie.

Le moteur Docker local n'est pas démarré : **la construction et l'exécution du conteneur Linux n'ont pas été testées**. Aucun accès direct à votre NAS n'a été utilisé. La vérification visuelle dans Browser était indisponible ; caméras, douchette et réception réelle des notifications restent à vérifier sur vos appareils. Les tests des rappels utilisent les vrais calculs et payloads chiffrés, avec des réponses réseau simulées.

Pour les notifications avec l'application fermée, l'appareil doit être abonné, le NAS allumé et connecté à Internet. HTTPS est nécessaire pour la caméra et les fonctions PWA ; sur iPhone/iPad, installez l'application sur l'écran d'accueil.

Le précédent rapport de publication Sites a été conservé dans `ETAT-LIVRAISON-SITES-HISTORIQUE.md`, hors du package. L'ancienne archive `myhomeia-site.tar.gz` reste un artefact Cloudflare historique.
