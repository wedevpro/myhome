# État de livraison — MyHomeIA sur Synology

15 octobre 2026, Europe/Paris. Cible : **DS920+, DSM 7.4.1-90080**, Container Manager, Linux amd64.

## Icône personnalisée dans les titres de listes

Les en-têtes des listes de courses et checklists affichent désormais l'icône enregistrée sur la liste, comme leurs boutons de sélection. Le composant partagé `components/list-icon.tsx` couvre les sept icônes disponibles et s'applique aux pages de listes, au tableau de bord, au mode cuisine et aux checklists liées. Si l'icône manque ou est inconnue, un panier est utilisé pour les courses et des cases pour les checklists.

Validation : compilation de production avec TypeScript et lint ciblé du composant d'icône et des encarts réussis. Le mapping et les valeurs de l'éditeur ont été revus ; aucun essai sur appareil ni sur le NAS pour cette modification.

## Boutons des listes de courses

Le scan apparaît à droite du champ **Ajouter un produit…**, sous la forme d'un bouton à icône seule, avec libellé accessible et infobulle. Sa cible mesure 44 × 44 px, ou 49 × 49 px en mode cuisine. Le bouton **Supprimer les éléments terminés** se trouve sous la zone des articles. Ces dispositions s'appliquent aux pages de courses, au tableau de bord et au mode cuisine ; la disposition des checklists est conservée.

Validation : lint ciblé et compilation de production avec TypeScript réussis. Les parcours navigateur existants passent à la souris et en émulation tactile ; les captures du mode cuisine confirment le scanner à droite du champ d'ajout sur ordinateur et à 390 px. Essais avec un Edge isolé, sans test sur appareil physique ni sur le NAS.

## Ajout des tâches de checklist

Le bouton **Ajouter une checklist liée** sous le champ d'ajout et sa fenêtre dédiée sont supprimés, avec leurs états, gestionnaire et styles. Une tâche s'ajoute via **Ajouter une tâche…** ; son menu **⋯ → Modifier l’élément** permet ensuite de lui associer une autre checklist. Ce changement s'applique également au tableau de bord et au mode cuisine. Les liens existants restent consultables et modifiables.

Validation : lint ciblé et compilation de production avec TypeScript réussis. Le parcours navigateur existant, adapté à l'ajout normal puis à l'association via l'éditeur, passe à la souris et en émulation tactile, avec retrait de lien, liens imbriqués, mode cuisine et bouton Retour mobile. Essais avec un Edge isolé, sans test sur appareil physique ni sur le NAS.

## En-têtes des courses et checklists

Les encarts affichent directement le **nom de la liste en cours**, aligné avec l'icône, sans descriptif statique ni sélecteur de liste. Les noms longs reviennent à la ligne et le compteur des articles à acheter reste visible dans l'en-tête. Le changement concerne les pages de listes, le tableau de bord et le mode cuisine, y compris la rotation. Les boutons avec icônes au-dessus des encarts restent le moyen de changer de liste sur leurs pages ; les listes du tableau de bord se choisissent dans les paramètres personnels.

Validation : lint ciblé et compilation de production avec TypeScript réussis. Les parcours navigateur existants ont été adaptés aux boutons de listes et aux paramètres du tableau de bord ; ils passent à la souris et en émulation tactile, avec les checklists liées, le mode cuisine et le bouton Retour mobile. Les captures des encarts de checklist et du mode cuisine ont été revues sur ordinateur et à 390 px. Essais avec un Edge isolé, sans test sur appareil physique ni sur le NAS.

## Bouton Retour sur mobile

Le bouton Retour de l'appareil ou du navigateur retrouve l'écran précédent, avec la liste sélectionnée, les liens entre checklists et la position de défilement de la page. Un menu ou une fenêtre ouverte se ferme d'abord. Sans écran précédent, l'application reste sur l'écran actuel. Le bouton Retour des checklists liées utilise le même historique sur mobile. Les modifications effectuées dans les listes restent conservées.

L'historique s'active sous 768 px ou avec un pointeur tactile, puis reste actif après redimensionnement. Il utilise des entrées à URL constante, sans recharger le document. Les états d'écran restent en mémoire ; un rechargement ou un changement de foyer ouvre un nouvel historique.

Validation : **95 tests unitaires réussis**, TypeScript, lint ciblé et compilation de production réussis. Le parcours navigateur de production passe à la souris et en émulation tactile : Retour/Suivant, racine protégée, menus et fenêtres, checklists liées imbriquées, bouton Retour de l'interface, retours rapides, rechargement et redimensionnement. Les tests vérifient la conservation du document et des modifications. Essais avec un Edge isolé, sans test sur appareil physique ni sur le NAS. Le lint global conserve les quatre erreurs et deux avertissements préexistants de `home-app.tsx`, contrôlés avant/après modification.

## Éléments liés à d'autres checklists

Un élément peut pointer vers une autre checklist du même foyer. Ajoutez-le via **Ajouter une tâche…**, puis utilisez **⋯ → Modifier l’élément** pour associer, changer ou retirer le lien. Le libellé cliquable ouvre la cible, avec un bouton Retour et une navigation possible entre liens successifs. Le tableau de bord et le mode cuisine retrouvent leur contexte sans changer les préférences de listes. Les cases restent indépendantes et le contenu lié n'est jamais recopié dans la liste principale.

Le lien `linkedChecklistId` est partagé et persistant, limité aux éléments de checklists et à une autre checklist du foyer. Un renommage conserve l'ID et le libellé personnalisé. La suppression de la cible retire les références entrantes en transaction avec audit/révision, en conservant les libellés et états des éléments parents ; supprimer une liste ne supprime pas ses cibles liées. Les écritures vérifient aussi l'existence de la cible au moment du SQL. Aucune migration de base n'est nécessaire. La démonstration contient une Trousse de toilette liée à la liste de vacances.

Validation : **78 tests unitaires réussis**, TypeScript, lint ciblé et compilation de production réussis. Le scénario API couvre partage, audits, références invalides/étrangères, conflits, cases indépendantes, tri/remise à zéro, retrait de lien, nettoyage à la suppression et persistance après redémarrage. Le parcours navigateur sur l'application de production en démonstration passe à la souris et en émulation tactile : ajout, édition, lien imbriqué avec retour, cases indépendantes, mode cuisine et suppression de cible. Le navigateur intégré reste indisponible ; ces essais ont utilisé un Edge isolé, sans test sur appareil physique ni sur le NAS. Le lint global conserve les quatre erreurs et deux avertissements préexistants de `home-app.tsx`, contrôlés avant/après modification.

## En-tête mobile accessible pendant le défilement

Sous 768 px, au même seuil que le menu latéral rétractable, l'en-tête utilise `position: sticky` en haut de l'écran. Le bouton du menu reste accessible pendant le défilement de la page. L'en-tête conserve sa place dans le contenu et son fond opaque, avec les menus et fenêtres au-dessus.

Validation : compilation de production et génération du worker réussies. Le CSS compilé contient la règle sticky uniquement dans le breakpoint mobile, avec `top: 0` et `z-index: 20`. La structure et les ancêtres ont été revus ; aucun contrôle visuel sur appareil mobile n'a été effectué pour cette modification.

## Sélection tactile des produits après défilement

Le sélecteur d'association de code-barres désactive la mise en évidence automatique au survol et le choix au simple relâchement de souris. Les événements souris de compatibilité d'un geste tactile ne peuvent ainsi plus sélectionner une suggestion par ce chemin, ni provoquer son défilement automatique au survol. Le choix explicite au clic/tap et les flèches puis Entrée continuent à cibler l'ID de la ligne choisie. Le défilement natif reste disponible.

Validation : **10 scénarios navigateur réussis**, avec le composant réel dans sa fenêtre Radix, le CSS de production et 100 produits fictifs. Ils vérifient les ID/noms après molette ou défilement tactile, sans filtre/avec filtre, avec une fenêtre elle-même défilante, l'absence de choix pendant le scroll et la sélection clavier sans soumission du formulaire. Le test des événements souris de compatibilité échoue sur l'ancien composant : un `mouseup` sans nouveau clic sélectionne un produit ; il passe avec le correctif. TypeScript, lint ciblé et compilation de production réussis. Le navigateur intégré reste indisponible ; ces essais ont utilisé un Edge isolé avec émulation tactile, sans essai sur un téléphone physique ni sur le NAS.

## Relais du défilement des listes vers la page

Les zones d'éléments des courses et checklists utilisent désormais `overscroll-behavior: auto` au lieu de `contain`. La page peut prendre le relais lorsque la liste est vide ou courte, ou lorsqu'elle atteint son début/sa fin. Le défilement interne des longues listes, leur hauteur maximale et la rotation cuisine sont conservés.

Le navigateur et le système gèrent ce relais natif ; sa continuité pendant un seul geste dépend de l'appareil. Le [projet de spécification CSSWG](https://drafts.csswg.org/css-overscroll-1/#scroll-chaining) permet d'autoriser le chaînage sans imposer sa gestuelle.

Validation : compilation Next.js de production et génération du worker réussies. Le CSS produit contient `overflow-y: auto`, `overscroll-behavior: auto` et la hauteur maximale de `56vh` pour les deux types de listes. Les gestionnaires de gestes ont été revus ; le comportement tactile n'a pas été vérifié sur appareil.

## Association d'un code-barres par auto-complétion

La fenêtre d'association utilise un seul champ **Nom du produit** avec auto-complétion. Une suggestion choisie cible son produit par ID. Sans choix explicite, un nom complet connu, sans casse ni accents et après suppression des espaces aux extrémités, réutilise le produit existant. Un nom inconnu crée un produit avec son orthographe saisie. Les correspondances partielles restent des suggestions, sans association automatique.

Le même rapprochement exact est contrôlé côté serveur sur le catalogue actuel du foyer. Plusieurs produits portant le même nom exigent un choix explicite. Un produit choisi puis supprimé bloque l'ajout jusqu'à correction ; un code déjà associé entre-temps à une autre cible est refusé sans mutation. Les codes existants, l'audit et les quantités/unités sont conservés. L'association fonctionne après caméra, douchette ou saisie manuelle.

Validation : **75 tests unitaires réussis**, dont quatre cas de comparaison des noms (accents Unicode, casse, noms complets, absence de mutation et ambiguïtés). TypeScript, lint ciblé du sélecteur/wrapper/helper/API, compilation de production et scénario API complet réussis. L'intégration vérifie l'association par nom, les codes multiples, le choix explicite parmi les doublons, les collisions sans mutation, l'isolation des foyers, l'audit et les rescans après redémarrage. Le portail et les événements clavier ont été revus dans les composants installés. Le navigateur intégré reste indisponible pour la vérification visuelle ; `home-app.tsx` conserve ses quatre erreurs de lint préexistantes.

## Libellés des éléments plus lisibles

Les noms des articles de courses et des tâches de checklist utilisent une police de **16 px** en affichage classique, **22 px** en mode cuisine et **20 px** en mode cuisine sur les écrans jusqu'à 767 px. Ce réglage s'applique aux pages de listes et aux tableaux de bord. L'interligne est de 1,45 et les textes longs reviennent à la ligne.

Validation : compilation Next.js de production et génération du worker de rappels réussies. Les règles de cascade et les différents affichages ont été revus dans le code ; aucun contrôle visuel sur appareil n'a été effectué.

## Cartes du tableau de bord et actions des courses

**Paramètres → Tableau de bord sur cet appareil** propose deux interrupteurs pour afficher/masquer séparément les cartes électricité et poubelles. Les deux sont visibles par défaut. Le choix est immédiat et mémorisé dans le navigateur de cet appareil, pour tous les foyers et pour les modes classique/cuisine. Il ne part pas dans les préférences serveur et ne se propage pas aux autres appareils. Une carte seule prend toute la ligne ; avec les deux masquées, la zone disparaît. Les réglages du foyer et les rappels continuent de fonctionner.

Si le stockage du navigateur est bloqué, les choix restent utilisables en mémoire pour la session. Les accès existants mémorisant le foyer actif et les marqueurs des rappels locaux sont également protégés pour ne pas interrompre le chargement ou le changement de foyer.

Les articles de courses ont maintenant un menu **⋯** avec **Modifier la quantité et la note** et **Supprimer l’article**. La quantité/unité s'affiche hors du menu uniquement lorsque la quantité est strictement supérieure à 1 et reste alors cliquable ; une unité longue revient à la ligne pour tenir sur mobile. Le menu reste accessible quelle que soit la quantité et reprend la gestion du focus et des gestes tactiles des checklists ; les actions et leur protection de révision restent celles de l'API existante.

Validation : **71 tests unitaires réussis**, dont 8 tests des préférences locales (valeurs par défaut, SSR sans stockage, lecture initiale, persistance, onglets, appareils indépendants et stockage bloqué). TypeScript, lint ciblé des nouveaux composants/helpers et du panneau de listes, compilation de production et scénario API complet réussis. Le HTML de démonstration confirme la quantité/unité hors menu et les boutons ⋯ des articles cochés/non cochés. Le navigateur intégré reste indisponible pour la vérification visuelle et tactile ; le lint global conserve les quatre erreurs préexistantes de `home-app.tsx`.

## Script de mise à jour Synology

[METTRE-A-JOUR-SYNOLOGY.sh](METTRE-A-JOUR-SYNOLOGY.sh), inclus dans le ZIP, automatise la mise à jour de `/volume1/docker/myhomeia`. Il se lance avec `sudo sh` depuis un emplacement hors de l'installation, avec le chemin du ZIP en argument facultatif. Avant toute interruption, il vérifie le package, le projet/service Compose et le volume de données réellement utilisé.

Le conteneur est arrêté avant la copie de `.env` et de tout `data/`. La sauvegarde datée est conservée dans `/volume1/docker/myhomeia-backups/`, avec accès restreint et marqueur de copie terminée. L'ancien `app/` est déplacé dans cette sauvegarde avant extraction, ce qui retire aussi les routes/fichiers applicatifs supprimés du nouveau ZIP. Le script restaure `.env` et le contenu de `data/` sans imbrication, conserve les permissions, reprend le projet Compose existant et lance la reconstruction/recréation du service. Il détecte les deux commandes Compose et attend le contrôle de santé.

En cas d'échec avant remplacement, le conteneur auparavant actif est relancé ; après remplacement ou déploiement, la sauvegarde reste disponible et la restauration est laissée explicite pour éviter d'écraser une base éventuellement migrée. Le script est en LF sans BOM, avec une règle Git pour conserver ce format. Aucun script n'a été exécuté sur votre NAS.

Validation du script : syntaxe `sh -n` réussie et **19 tests d'intégration réussis** dans `tests/synology-update.test.mjs`, avec vrais ZIP/CRC/extractions et Docker/Compose simulés. Ils couvrent chemins avec espaces, sauvegarde/restauration sans `data/data`, arrêt confirmé avant copie, projet Compose réel, mode Compose historique, retrait des anciens fichiers applicatifs, refus des archives incomplètes/corrompues/contenant `.env` ou `data`, `.dockerignore` obligatoire, volume/labels incohérents, configuration invalide, échecs de copie/build, nettoyage des fichiers temporaires et absence de secrets dans la sortie. Cette validation est distincte des 63 tests applicatifs précédents ; aucune mise à jour réelle du NAS n'a été lancée.

## Tableau de bord en mode cuisine

La rotation alterne maintenant uniquement entre la liste de courses et la checklist choisies dans **Paramètres → Mon tableau de bord**. Les autres listes du foyer ne sont plus ajoutées à la rotation. Lorsqu'un seul type de liste est disponible, il reste affiché. Le délai configuré et les pauses pendant menus, fenêtres et saisies sont conservés.

Un swipe horizontal permet de changer immédiatement de liste ; des flèches proposent aussi la navigation au clic/clavier. Les gestes verticaux gardent leur défilement natif. Chaque interaction avec la liste, chaque swipe et la fin d'un enregistrement réinitialisent le délai complet. Les enregistrements suspendent la rotation ; après une pause à l'échéance (menu, fenêtre, saisie ou application masquée), elle repart avec un délai complet. Un seul minuteur reste actif.

La carte électrique affiche la prochaine bascule HP/HC, son horaire et le temps restant, en précisant demain ou la date si nécessaire. Le calcul fusionne les plages adjacentes/chevauchantes, respecte leur jour de début la nuit et les changements d'heure Europe/Paris. Une couverture permanente indique qu'aucun changement n'est prévu ; sans règle, l'invitation à configurer les horaires reste affichée.

Sur mobile, la navigation ferme le menu latéral. Le wrapper partagé des menus attend un tap tactile complet : un mouvement de plus de 8 px, une annulation ou plusieurs doigts empêche l'ouverture, sans bloquer le défilement natif. Souris, clavier, focus et références Radix sont conservés.

Les cartes électricité et poubelles utilisent des textes plus grands en mode cuisine : état/type de bac à 26–30 px, descriptions et rappels à 14–16 px, décompte des jours à 48–52 px. Les libellés et badges sont également agrandis, avec retour à la ligne des textes longs et adaptation aux petits écrans.

Validation : **63 tests unitaires réussis**, dont 15 nouveaux cas de prochaine bascule électrique (nuit, semaine, chevauchements, changements d'heure), 9 tests de rotation avec horloge simulée et 8 tests de tap/défilement/annulation. TypeScript, lint ciblé des nouveaux composants/helpers et des wrappers sidebar/menu, compilation de production et scénario API complet réussis. La sélection personnelle par foyer et les cas de liste unique ont été revus. `home-app.tsx` conserve quatre erreurs de lint préexistantes ; le lint global ne passe donc pas entièrement. Le navigateur intégré reste indisponible : swipe, défilement tactile, fermeture du drawer et rendu des cartes n'ont pas été vérifiés visuellement sur appareil.

## Organisation et nettoyage des listes

Les commandes d'ajout sont en haut des courses et des checklists, avec le scan pour les courses. Les longues listes disposent d'une zone d'éléments défilante, séparée de ces commandes. Tous les éléments cochés apparaissent en bas ; l'ordre relatif reste conservé dans les groupes à faire/terminés. Les actions d'une tâche sont regroupées derrière un bouton ⋯ : modification du libellé, monter/descendre, choix de position et suppression. Les déplacements restent dans le groupe de même état. La rotation cuisine se suspend pendant un menu ouvert.

Les tâches des checklists éphémères restent désormais cochées jusqu'à leur suppression. Le bouton **Supprimer les éléments terminés** est disponible dans les courses et les checklists éphémères, avec confirmation du nombre de cibles. Le nettoyage porte sur la liste complète, même sous filtre. Une commande atomique contrôle chaque ID/révision et l'accès au foyer : aucune suppression partielle en cas de conflit, aucun effacement des nouveaux cochés hors de la confirmation. Les éléments à faire, les fiches produits, les autres listes et les checklists réutilisables sont conservés. Le renommage d'une tâche garde ses autres champs, son ordre et son audit de création.

Validation : **31 tests unitaires réussis**, TypeScript, lint ciblé et compilation de production réussis. Le scénario API valide purge par un membre, conflits bloquant toute suppression, validations, isolation, refus sur liste réutilisable, renommage/audit, gros lots et plafond HTTP, puis suppressions et survivants après redémarrage. Le HTML de démonstration confirme les commandes avant les éléments et les boutons de menu. `home-app.tsx` conserve cinq erreurs de lint préexistantes (six dans l'archive précédente) ; le lint global n'est donc pas entièrement validé. Le navigateur intégré reste indisponible pour le contrôle visuel.

## Quantité et note des articles de courses

L'action **Modifier la quantité et la note** du menu ⋯ ouvre un formulaire d'édition propre à l'article, quelle que soit sa quantité. La quantité et son unité s'affichent uniquement lorsque la quantité est strictement supérieure à 1 ; cliquer sur cette quantité ouvre aussi le formulaire. Il accepte des quantités décimales positives jusqu'à 10 000 et une note facultative de 2 000 caractères, affichée sous le nom dans la liste. Vider le champ retire la note. Les commandes sont disponibles dans les listes de courses, le tableau de bord et le mode cuisine, avec des cibles tactiles adaptées.

La note est partagée dans le foyer mais reste attachée uniquement à cette ligne : aucune modification de la fiche produit ni propagation aux autres articles, y compris lors d'un nouvel ajout du même produit. Cocher l'article conserve la note ; supprimer sa ligne la retire. La sauvegarde préserve les références, l'unité et l'état coché, avec audit et contrôle de révision. Les anciens articles restent compatibles et aucune migration SQL n'est nécessaire.

Validation : **29 tests unitaires réussis**, TypeScript, lint des composants modifiés et compilation de production réussis. Le scénario API sur le serveur de production valide édition, décimales, effacement, partage/audit, conflits, valeurs invalides, isolation, catalogue et autres lignes inchangés, absence de recopie lors d'un ajout ultérieur, et persistance après redémarrage. Le rendu HTML de démonstration contient les deux nouveaux contrôles. La vérification visuelle reste indisponible dans le navigateur intégré.

## Tri, ordre et recherche dans les checklists

Ajout des boutons **A–Z / Z–A**, des déplacements par flèches ou position numérique (maintenant dans le menu de l'élément), et d'un filtre ignorant casse et accents. Les commandes sont disponibles dans la page Checklists, le tableau de bord et le mode cuisine. Le filtre agit uniquement sur l'affichage ; les tris et déplacements concernent toujours la liste complète, avec regroupement des cochés en bas. La rotation cuisine est suspendue pendant un menu, une fenêtre ouverte ou une saisie dans le panneau.

L'ordre est enregistré dans les données JSON de la checklist et partagé avec le foyer, avec audit et révision. Une permutation incomplète, des IDs étrangers ou un état périmé sont refusés sans perte de tâches. Les anciens éléments gardent leur ordre tant que la liste n'est pas réordonnée ; les nouveaux arrivent à la fin. Renommer et remettre à zéro préservent l'ordre. Aucune migration ni suppression de données n'est nécessaire.

Validation initiale : 25 tests unitaires réussis, compilation de production et scénario API complet de partage/persistance/conflits/audit/renommage/remise à zéro réussis. Le rendu HTML de démonstration contient les nouveaux contrôles. Le lint des nouveaux composants/helpers et de la route de commande passe. La vérification visuelle reste indisponible dans le navigateur intégré.

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
- Tests de domaine, rotation/gestes, préférences de l'appareil, association des produits, articles de courses, checklists, authentification, SQLite et rappels : **75 tests réussis** (22 domaine, 9 rotation/swipe, 8 menus tactiles, 8 préférences locales, 4 comparaisons de noms produits, 4 articles de courses, 7 checklists/ordre des cochés, 5 authentification, 7 stockage NAS, 1 rappels avec plusieurs scénarios).
- Intégration sur serveur de production : affichage du tableau de bord authentifié après inscription, connexion et redémarrage ; accès à `/deconnexion` ; quantités et notes des articles, validations, partage/audit, conflits, isolation, catalogue inchangé et absence de recopie ; ordre et libellés des checklists, conservation après renommage/remise à zéro ; purge atomique des terminés, permissions, isolation, checklists réutilisables protégées, commandes en haut et persistance après redémarrage ; partage et isolation des foyers, rôles, codes-barres, préférences et contrôle d'origine : réussie.

Le moteur Docker local n'est pas démarré : **la construction et l'exécution du conteneur Linux n'ont pas été testées**. Aucun accès direct à votre NAS n'a été utilisé. La vérification visuelle dans Browser était indisponible ; caméras, douchette et réception réelle des notifications restent à vérifier sur vos appareils. Les tests des rappels utilisent les vrais calculs et payloads chiffrés, avec des réponses réseau simulées.

Pour les notifications avec l'application fermée, l'appareil doit être abonné, le NAS allumé et connecté à Internet. HTTPS est nécessaire pour la caméra et les fonctions PWA ; sur iPhone/iPad, installez l'application sur l'écran d'accueil.

Le précédent rapport de publication Sites a été conservé dans `ETAT-LIVRAISON-SITES-HISTORIQUE.md`, hors du package. L'ancienne archive `myhomeia-site.tar.gz` reste un artefact Cloudflare historique.
