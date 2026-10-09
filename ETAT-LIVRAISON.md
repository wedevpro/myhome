# État de livraison — MyHomeIA sur Synology

9 octobre 2026, Europe/Paris. Cible : **DS920+, DSM 7.4.1-90080**, Container Manager, Linux amd64.

## Quantité et note des articles de courses

La quantité et le bouton crayon ouvrent maintenant un formulaire d'édition propre à l'article. Il accepte des quantités décimales positives jusqu'à 10 000 et une note facultative de 2 000 caractères, affichée sous le nom dans la liste. Vider le champ retire la note. Les commandes sont disponibles dans les listes de courses, le tableau de bord et le mode cuisine, avec des cibles tactiles adaptées.

La note est partagée dans le foyer mais reste attachée uniquement à cette ligne : aucune modification de la fiche produit ni propagation aux autres articles, y compris lors d'un nouvel ajout du même produit. Cocher l'article conserve la note ; supprimer sa ligne la retire. La sauvegarde préserve les références, l'unité et l'état coché, avec audit et contrôle de révision. Les anciens articles restent compatibles et aucune migration SQL n'est nécessaire.

Validation : **29 tests unitaires réussis**, TypeScript, lint des composants modifiés et compilation de production réussis. Le scénario API sur le serveur de production valide édition, décimales, effacement, partage/audit, conflits, valeurs invalides, isolation, catalogue et autres lignes inchangés, absence de recopie lors d'un ajout ultérieur, et persistance après redémarrage. Le rendu HTML de démonstration contient les deux nouveaux contrôles. La vérification visuelle reste indisponible dans le navigateur intégré.

## Tri, ordre et recherche dans les checklists

Ajout des boutons **A–Z / Z–A**, des flèches de déplacement, d'une position numérique cliquable pour déplacer un élément directement, et d'un filtre ignorant casse et accents. Les commandes sont disponibles dans la page Checklists, le tableau de bord et le mode cuisine. Le filtre agit uniquement sur l'affichage ; les tris et déplacements concernent toujours la liste complète. La rotation cuisine est suspendue pendant une fenêtre ouverte ou une saisie dans le panneau.

L'ordre est enregistré dans les données JSON de la checklist et partagé avec le foyer, avec audit et révision. Une permutation incomplète, des IDs étrangers ou un état périmé sont refusés sans perte de tâches. Les anciens éléments gardent leur ordre tant que la liste n'est pas réordonnée ; les nouveaux arrivent à la fin. Renommer et remettre à zéro préservent l'ordre. Aucune migration ni suppression de données n'est nécessaire.

Validation : 25 tests unitaires réussis, compilation de production et scénario API complet de partage/persistance/conflits/audit/renommage/remise à zéro réussis. Le rendu HTML de démonstration contient les nouveaux contrôles. Le lint des nouveaux composants/helpers et de la route de commande passe ; `home-app.tsx` conserve six erreurs de lint préexistantes, confirmées par comparaison avec l'archive précédente. La vérification visuelle reste indisponible dans le navigateur intégré.

## Modes d'affichage

Le mode clair est le défaut. Une section **Paramètres → Apparence** propose **Mode Clair**, **Mode Sombre** et **Appliquer le mode de l'appareil**. La préférence s'applique immédiatement, reste mémorisée dans le navigateur de cet appareil et suit les changements du système uniquement si le troisième choix est sélectionné. Les cartes, listes, formulaires, menus, fenêtres et notifications d'interface sont adaptés au mode sombre ; les couleurs personnalisées d'électricité sont conservées.

Vérifications de cette modification : TypeScript, lint des composants d'apparence, compilation de production et intégration API/pages authentifiées réussis ; script d'initialisation réellement rendu côté serveur contrôlé pour six cas (sans préférence sur appareil clair/sombre, préférence claire/sombre, mode appareil clair/sombre). Le contrôle visuel dans le navigateur intégré reste indisponible.

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
- Tests de domaine, articles de courses, checklists, authentification, SQLite et rappels : **29 tests réussis** (7 domaine, 4 articles de courses, 5 checklists, 5 authentification, 7 stockage NAS, 1 rappels avec plusieurs scénarios).
- Intégration sur serveur de production : affichage du tableau de bord authentifié après inscription, connexion et redémarrage ; accès à `/deconnexion` ; quantités et notes des articles, validations, partage/audit, conflits, isolation, catalogue inchangé et absence de recopie ; ordre partagé des checklists, audit, conflits, conservation après renommage/remise à zéro et redémarrage ; partage et isolation des foyers, rôles, codes-barres, préférences et contrôle d'origine : réussie.

Le moteur Docker local n'est pas démarré : **la construction et l'exécution du conteneur Linux n'ont pas été testées**. Aucun accès direct à votre NAS n'a été utilisé. La vérification visuelle dans Browser était indisponible ; caméras, douchette et réception réelle des notifications restent à vérifier sur vos appareils. Les tests des rappels utilisent les vrais calculs et payloads chiffrés, avec des réponses réseau simulées.

Pour les notifications avec l'application fermée, l'appareil doit être abonné, le NAS allumé et connecté à Internet. HTTPS est nécessaire pour la caméra et les fonctions PWA ; sur iPhone/iPad, installez l'application sur l'écran d'accueil.

Le précédent rapport de publication Sites a été conservé dans `ETAT-LIVRAISON-SITES-HISTORIQUE.md`, hors du package. L'ancienne archive `myhomeia-site.tar.gz` reste un artefact Cloudflare historique.
