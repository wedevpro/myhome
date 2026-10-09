# Architecture MyHomeIA — version NAS

Application web responsive installable (PWA), avec **Next.js, React et TypeScript**, exécutée dans Node.js. Le stockage utilise SQLite natif via `node:sqlite`. L'installation Synology construit un conteneur Linux amd64 avec Node.js 24 et ne dépend ni de Firebase, ni de Cloudflare, ni de l'identité ChatGPT.

Le déploiement, le proxy HTTPS et les sauvegardes sont décrits dans [GUIDE-SYNOLOGY.md](../../GUIDE-SYNOLOGY.md). Les commandes de développement et de vérification sont dans [README.md](../README.md).

## Fonctionnalités implémentées

| Module | Comportement |
| --- | --- |
| Courses | Plusieurs listes, nom et icône, quantités, cases à cocher et suppression. |
| Produits | Catalogue du foyer, plusieurs codes-barres par produit, unicité d'un code dans le foyer. Un nouveau produit peut être conservé au catalogue ou ajouté uniquement à la liste. |
| Scan | Caméra avant/arrière avec ZXing, douchette clavier USB/Bluetooth et saisie manuelle. Produit reconnu ajouté directement ; code inconnu associé à un produit existant ou nouveau. |
| Checklists | Listes éphémères : tâche terminée supprimée. Listes réutilisables : éléments conservés et remise à zéro collective. Tri A–Z/Z–A, déplacement par flèches ou position numérique, filtre ignorant casse et accents. Ordre partagé et persistant. |
| Notes | Création, édition, suppression, recherche et trois couleurs. Texte simple ; dessin, pièces jointes et synchronisation Samsung Notes ne sont pas intégrés. |
| Contacts | Nom, téléphone, email et adresse. Catégories imbriquées sans limite configurée de profondeur ; le filtre d'une catégorie inclut ses descendants. |
| Électricité | Plusieurs plages avec choix des jours et passage de minuit. État heures pleines/creuses et couleurs personnelles. Calculs dans le fuseau Europe/Paris. |
| Poubelles | Type, couleur, jour de sortie, heure du rappel, récurrence hebdomadaire ou toutes les 2–4 semaines et date de référence. Décompte fondé sur le jour de sortie. |
| Tableau de bord | Liste de courses et checklist choisies par utilisateur et par foyer. Affichage côte à côte ou rotation de toutes les listes en mode cuisine ; délai de 5 à 300 secondes. Plein écran et Wake Lock selon navigateur. |
| Foyers | Création, adhésion par code, sélection, renommage et renouvellement du code. Le créateur est administrateur ; un nouveau membre est utilisateur simple. |
| Administration | Promotion, rétrogradation et retrait de membres. Protection atomique du dernier administrateur. Un membre retiré ne peut pas revenir avec le même code. |
| Traçabilité | `created_by`, `created_at`, `updated_by`, `updated_at` fixés côté serveur. UUID de révision pour rejeter les écrasements concurrents. |

## Comptes et isolation des foyers

Chaque personne crée un compte MyHomeIA avec un nom, une adresse email et un mot de passe d'au moins **12 caractères**. L'adresse email est normalisée ; les mots de passe sont dérivés avec `scrypt` et un sel aléatoire. Aucun mot de passe en clair n'est stocké.

Les sessions durent **30 jours**. Le navigateur reçoit un cookie `HttpOnly`, `SameSite=Lax` et `Secure` en production ; la base conserve seulement le hash du jeton de session. Une déconnexion retire la session serveur. Les tentatives de connexion et les inscriptions sont limitées.

Chaque endpoint déduit l'utilisateur de la session et vérifie son adhésion au foyer côté serveur. Les rôles appartiennent au couple foyer/utilisateur : la même personne peut administrer un foyer et être membre d'un autre. Les opérations d'administration et les paramètres d'horaires nécessitent un administrateur. Les comptes DSM et les anciens headers d'identité Sites n'accordent aucun accès à l'application.

Les requêtes de mutation vérifient leur origine et bornent le corps reçu. En production, `SITE_ORIGIN` doit correspondre à l'adresse HTTPS utilisée dans le navigateur. Les champs d'identité et de traçabilité ne proviennent pas du client.

## Stockage et migrations

Le conteneur s'exécute avec **UID/GID 1000** et monte `./data:/app/data`. La base est définie par `DB_PATH=/app/data/myhomeia.sqlite`. En développement, `DB_PATH` peut désigner un autre fichier ; aucun fichier de base de production n'est incorporé à l'image.

Le wrapper `lib/sqlite.ts` conserve le contrat de statements préparés de l'application sur `node:sqlite` :

- clés étrangères activées ;
- `busy_timeout=5000`, soit une attente jusqu'à cinq secondes lors d'un verrouillage ;
- journal `DELETE` ;
- opérations groupées exécutées dans une transaction `BEGIN IMMEDIATE`, avec rollback de tout le batch si une instruction échoue.

Les migrations numérotées de `drizzle/` sont lues dans l'ordre au démarrage. Chaque fichier SQL est exécuté **entièrement** dans sa propre transaction, ce qui conserve les triggers. La table `app_migrations` enregistre le nom et le checksum SHA-256. Un checksum différent pour une migration déjà appliquée interdit le démarrage, sans réexécuter son SQL.

Pour modifier le schéma, ajouter une nouvelle migration SQL versionnée ; ne pas réécrire un fichier déjà appliqué. La génération `db:generate` a été retirée : les anciens snapshots Drizzle doivent être réalignés avant de rétablir une génération automatique. Le build ne modifie pas les migrations.

Tables de données : `users`, `households`, `memberships`, `records`, `barcodes`, `preferences`, `accounts`, `sessions`, `auth_rate_limits`, `push_settings`, `push_subscriptions`, `push_deliveries` et `app_migrations`. Les données des modules sont en JSON dans `records` ; les données partagées appartiennent au foyer et les préférences au couple foyer/utilisateur.

Les triggers SQLite contrôlent les références entre listes, produits et catégories lors de l'écriture. Ils interdisent les références entre foyers, les orphelins et les cycles de catégories. La table des codes-barres impose l'unicité `(household_id, code)` et conserve les zéros initiaux. Les clés Push privées restent dans une table serveur absente des réponses de lecture.

L'ordre d'une checklist est un tableau d'IDs `itemOrder` dans le JSON de sa liste. La commande `reorderChecklist` écrit une permutation exacte des tâches, en contrôlant atomiquement leur ensemble, la révision de la liste et l'adhésion active au foyer. Les formulaires de renommage préservent cet ordre serveur. Le client ignore les IDs supprimés et place les nouveaux éléments en fin ; la recherche filtre uniquement l'affichage. Aucun changement de schéma n'est requis.

## Build et supervision

`npm run build` compile Next.js avec `output: standalone`, copie les assets publics et génère le bundle autonome `runtime/reminders.mjs` avec esbuild.

`scripts/nas-entrypoint.mjs` démarre deux processus : le serveur standalone et le planificateur. Si l'un s'arrête de façon inattendue, l'entrée arrête l'autre et termine le service ; la politique Compose `restart: unless-stopped` peut alors redémarrer l'ensemble. Les signaux d'arrêt sont transmis aux deux processus.

Le contrôle `GET /api/health` est utilisé par Docker. Le port du conteneur est 3000, publié uniquement sur `127.0.0.1:3080` du NAS. Le proxy DSM fournit l'adresse HTTPS configurée dans `SITE_ORIGIN`.

Une seule instance du conteneur est prévue. Pour sauvegarder, arrêter le projet puis copier tout `data/` et le fichier `.env`. À la mise à jour, conserver ces éléments et reconstruire l'image. Une restauration après changement de schéma doit utiliser une sauvegarde compatible avec la version applicative.

## Synchronisation

Les données sont persistées sur le NAS. Les mutations sont ciblées par élément. Le client relit l'état toutes les **2,5 secondes** lorsque l'application est visible, après chaque mutation et au retour sur la fenêtre. Cette synchronisation se fait donc en quelques secondes. Une modification fondée sur une ancienne révision est rejetée avec HTTP 409.

Le navigateur conserve des états propres à l'appareil, comme le foyer actif et les marqueurs des rappels locaux. Les préférences de tableau de bord restent en base, par utilisateur et par foyer. Il n'existe pas de file d'écritures hors ligne synchronisée au retour du réseau.

## Notifications avec l'application fermée

Le processus `scripts/reminder-worker.ts`, compilé dans `runtime/reminders.mjs`, ouvre SQLite et vérifie les rappels au lancement, puis attend **60 secondes** entre deux passages. Il appelle directement les fonctions d'envoi ; aucun appel HTTP à une API de planification ni secret de scheduler externe n'est nécessaire.

Le service worker, l'abonnement par appareil, la génération VAPID durable et l'envoi serveur sont intégrés. Le bouton de test permet de vérifier un abonnement. Les envois automatiques sont tentés pendant les trente minutes suivant l'heure configurée. Une clé par abonnement/règle/date et un bail de reprise limitent les doublons ; la livraison réseau ne garantit pas exactement un affichage.

La réception avec l'application fermée demande :

- un appareil compatible qui a autorisé les notifications et possède un abonnement ;
- le conteneur et le NAS en fonctionnement ;
- un accès Internet du NAS vers le service Push de l'appareil ;
- l'adresse HTTPS prévue et reconnue par le navigateur.

Sur iPhone/iPad, la PWA doit être ajoutée à l'écran d'accueil avant l'activation. Aucun compte développeur Apple ni fournisseur Push payant n'est requis. [Documentation WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Les endpoints d'envoi sont limités à des services Push HTTPS connus. Les abonnements invalidés sont retirés ; l'adhésion au foyer et les préférences de notifications sont revérifiées avant chaque envoi. `/api/push/run` n'est pas utilisé par le planificateur interne.

## Compatibilité du scan et de la tablette

| Solution | Web/PWA | Points à vérifier sur le matériel |
| --- | --- | --- |
| Caméra arrière | `getUserMedia` et ZXing | HTTPS, permission caméra et focus. |
| Caméra avant | Choix explicite disponible | Un focus fixe peut limiter la lecture des petits codes proches. |
| Douchette USB / USB-C | Mode HID clavier | Mode USB hôte, adaptateur éventuel et suffixe Entrée. |
| Douchette Bluetooth | Mode HID clavier | Appairage système ; les modes BLE/SDK propriétaires nécessitent une autre intégration. |
| Notifications Android | Selon navigateur et permission | Abonnement et accès Internet du NAS. |
| Notifications iPhone/iPad | iOS/iPadOS 16.4+ | PWA sur l'écran d'accueil et permission demandée au clic. |
| Écran permanent | Wake Lock proposé | Le système peut le relâcher ; mode kiosque et alimentation à configurer sur la tablette. |

Références : [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [ZXing](https://github.com/zxing-js/browser), [USB HID Zebra](https://docs.zebra.com/us/en/tablets/et5-series/et51-56-prg/c-et51-56-data-capture/t-usb-connecting-a-usb-scanner-using-hid.html), [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

## Vérifications et limites de livraison

`npm test` couvre le domaine, les migrations, la réouverture de SQLite, les rollbacks, les références, les droits et l'authentification. `npm run test:api` démarre une instance standalone avec une base temporaire, vérifie les comptes, les sessions, le partage et l'isolation des foyers, les rôles, les codes-barres, les conflits de révision, les préférences et la persistance après un arrêt/redémarrage.

La compilation Next.js en production et la validation de la configuration Docker Compose ont réussi sur le poste de préparation. Les résultats définitifs des suites de tests sont précisés à la livraison.

Le moteur Docker local est arrêté : aucune construction ni exécution de l'image Docker n'a été validée. Aucun essai direct sur le Synology n'a été effectué. Le navigateur de QA intégré est indisponible ; le rendu, les caméras, la douchette et la réception des notifications doivent être vérifiés sur les appareils réels.

Les notes sont en texte simple ; dessin et pièces jointes ne sont pas intégrés. Aucun envoi d'email de validation ni parcours de récupération de mot de passe n'est configuré.

L'ancienne archive Sites est conservée à titre historique, hors du package NAS. Les données Cloudflare de cette ancienne version ne sont pas importées automatiquement dans la nouvelle base.
