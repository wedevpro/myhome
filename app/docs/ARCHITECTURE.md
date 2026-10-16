# Architecture myHome — version NAS

Application web responsive installable (PWA), avec **Next.js, React et TypeScript**, exécutée dans Node.js. Le stockage utilise SQLite natif via `node:sqlite`. L'installation Synology construit un conteneur Linux amd64 avec Node.js 24 et ne dépend ni de Firebase, ni de Cloudflare, ni de l'identité ChatGPT.

Le déploiement, le proxy HTTPS et les sauvegardes sont décrits dans [GUIDE-SYNOLOGY.md](../../GUIDE-SYNOLOGY.md). Les commandes de développement et de vérification sont dans [README.md](../README.md).

## Fonctionnalités implémentées

| Module | Comportement |
| --- | --- |
| Courses | Plusieurs listes, nom et icône, ajout et scan en haut, zone d'éléments défilante. Quantités modifiables (décimales acceptées), quantité/unité affichée uniquement si la quantité est strictement supérieure à 1, commentaire propre à chaque article, cochés en bas et suppression collective des terminés avec confirmation. Le commentaire n'est pas enregistré au catalogue ni recopié sur d'autres articles. |
| Produits | Catalogue du foyer, plusieurs codes-barres par produit, unicité d'un code dans le foyer. Un nouveau produit peut être conservé au catalogue ou ajouté uniquement à la liste. |
| Scan | Caméra avant/arrière avec ZXing, douchette clavier USB/Bluetooth et saisie manuelle. Produit reconnu ajouté directement ; code inconnu associé via un seul champ de nom avec auto-complétion. Suggestion choisie par ID ou nom complet reconnu sans casse/accents : réutilisation du produit. Nom inconnu : création. Plusieurs noms identiques : choix explicite exigé. |
| Checklists | Ajout en haut, cochés en bas, libellés modifiables et lien facultatif vers une autre checklist du foyer. Listes éphémères : tâches terminées conservées jusqu'à suppression individuelle ou collective. Listes réutilisables : remise à zéro, sans purge collective. Tri A–Z/Z–A, filtre ignorant casse et accents, menu par élément pour modifier, déplacer par flèches ou position et supprimer. Ordre et liens partagés et persistants. |
| Notes | Création, édition, suppression, recherche et trois couleurs. Texte simple ; dessin, pièces jointes et synchronisation Samsung Notes ne sont pas intégrés. |
| Contacts | Nom, téléphone, email et adresse. Catégories imbriquées sans limite configurée de profondeur ; le filtre d'une catégorie inclut ses descendants. |
| Électricité | Plusieurs plages avec choix des jours et passage de minuit. État heures pleines/creuses et couleurs personnelles. Calculs dans le fuseau Europe/Paris. |
| Poubelles | Type, couleur, jour de sortie, heure du rappel, récurrence hebdomadaire ou toutes les 2–4 semaines et date de référence. Décompte fondé sur le jour de sortie. |
| Tableau de bord | Liste de courses et checklist choisies par utilisateur et par foyer. Affichage côte à côte ou rotation limitée aux deux listes sélectionnées en mode cuisine ; délai de 5 à 300 secondes. Visibilité électricité/poubelles réglable séparément dans le navigateur de chaque appareil ; textes agrandis en mode cuisine. Plein écran et Wake Lock selon navigateur. |
| Foyers | Création, adhésion par code, sélection, renommage et renouvellement du code. Le créateur est administrateur ; un nouveau membre est utilisateur simple. |
| Administration | Promotion, rétrogradation et retrait de membres. Protection atomique du dernier administrateur. Un membre retiré ne peut pas revenir avec le même code. |
| Traçabilité | `created_by`, `created_at`, `updated_by`, `updated_at` fixés côté serveur. UUID de révision pour rejeter les écrasements concurrents. |

Les encarts de courses et checklists partagent `components/list-panel.tsx`. Leur titre affiche directement le nom de la liste, sans descriptif ni sélecteur, avec retour à la ligne des noms longs. Les pages de listes utilisent leurs onglets avec icônes pour la sélection ; les encarts du tableau de bord et du mode cuisine suivent les préférences personnelles. Le compteur des articles à acheter figure dans l'en-tête.

## Application Android et widgets

Le dossier `android/` contient une application Java utilisant les composants Android standards, sans dépendance d'interface tierce. `MainActivity` charge l'interface HTTPS du NAS dans une WebView limitée à cette origine ; les liens extérieurs restent dans les applications adaptées. Le widget utilise `AppWidgetProvider`, une collection `RemoteViewsService`, une activité de configuration par instance et des jobs réseau. Les activités de destination sont directement ciblées par les `PendingIntent`, sans lancement d'écran depuis un receiver.

La session HttpOnly de la WebView est réutilisée par le client HTTP natif pour `/api/state` et `/api/command`, avec l'en-tête `Origin` du NAS. Une instance du client reste liée à une session et refuse une requête si celle-ci change. Aucun endpoint, mot de passe stocké ni pont JavaScript privilégié n'est ajouté. Les rôles, audits et contrôles d'accès restent ceux des API existantes.

Chaque widget conserve son foyer et sa liste. Seuls cette liste et ses articles sont mis en cache dans le stockage privé Android, avec une empreinte de la session attendue. Les réponses obtenues pour une ancienne session ne peuvent pas devenir le cache d'une nouvelle connexion. Une erreur d'authentification efface les caches ; la suppression de la liste retire son cache. Les cases envoient une sauvegarde ciblée avec la révision attendue ; aucune écriture n'est rejouée automatiquement après interruption. Les autres widgets du foyer sont actualisés après un cochage réussi.

L'ajout, l'édition, la suppression, le nettoyage et le scan utilisent des liens `/?mobileWidget=1&household=…&list=…&action=…`, avec `item` pour l'édition ou la suppression d'un article. Un helper valide strictement la destination sur le snapshot autorisé ; une URL n'exécute aucune mutation. Le foyer demandé est chargé avant la liste et les erreurs ne basculent pas vers une autre liste. Les actions d'ouverture sont consommées en `action=open` afin d'éviter leur répétition au rechargement. Un chemin canonique sans identifiants de connexion peut être conservé trente minutes en sessionStorage pour reprendre après authentification.

Le widget demande un rafraîchissement périodique toutes les trente minutes, manuel et après les interactions. Android peut différer les jobs en arrière-plan. La WebView demande aussi une actualisation au retour de l'application vers le lanceur. Les composants natifs nécessitent une nouvelle APK ; les écrans web restent actualisables sur le NAS. Voir [INSTALLER-ANDROID.md](../../INSTALLER-ANDROID.md) pour la construction et la clé de signature persistante.

## Navigation mobile

`lib/app-navigation-history.ts` gère les entrées History API à URL constante. Son curseur `__myhome_navigation` est ajouté sans écraser les champs de Next.js. Les scènes restent dans une table en mémoire : page, listes sélectionnées, catalogue, mode cuisine, retour entre checklists liées, recherche, catégorie et défilement de la page. Un changement d'écran crée une entrée ; une saisie ou un défilement actualise la scène courante sans multiplier les étapes de retour.

`hooks/use-app-navigation-history.ts` active le contrôleur après hydratation, sous 768 px ou avec un pointeur tactile. L'activation persiste pendant les redimensionnements. `popstate` restaure l'écran sans recharger le document ni annuler les mutations de données. Les menus et fenêtres consomment d'abord le retour via leur fermeture. Une entrée de garde avant la première scène renvoie vers celle-ci avec `history.go(1)` pour rester dans l'application tout en conservant la branche Suivant.

Le foyer définit la portée de l'historique : changer de foyer ou recharger la page crée une nouvelle portée et ne restaure pas les anciennes scènes. Le nettoyage retire les écouteurs sans déclencher de navigation ; il tolère le remontage des effets en Strict Mode. Le bouton Retour des checklists liées appelle le même contrôleur lorsqu'il est actif, et conserve son comportement existant sur ordinateur.

Les tests unitaires simulent les traversées asynchrones, les branches, les fenêtres, les retours rapides, les portées et les métadonnées Next.js. Le test navigateur de production vérifie aussi le document conservé, les liens imbriqués, le rechargement et l'activation persistante après redimensionnement.

## Comptes et isolation des foyers

Chaque personne crée un compte myHome avec un nom, une adresse email et un mot de passe d'au moins **12 caractères**. L'adresse email est normalisée ; les mots de passe sont dérivés avec `scrypt` et un sel aléatoire. Aucun mot de passe en clair n'est stocké.

Les sessions durent **30 jours**. Le navigateur reçoit un cookie `HttpOnly`, `SameSite=Lax` et `Secure` en production ; la base conserve seulement le hash du jeton de session. Une déconnexion retire la session serveur. Les tentatives de connexion et les inscriptions sont limitées.

Chaque endpoint déduit l'utilisateur de la session et vérifie son adhésion au foyer côté serveur. Les rôles appartiennent au couple foyer/utilisateur : la même personne peut administrer un foyer et être membre d'un autre. Les opérations d'administration et les paramètres d'horaires nécessitent un administrateur. Les comptes DSM et les anciens headers d'identité Sites n'accordent aucun accès à l'application.

Les requêtes de mutation vérifient leur origine et bornent le corps reçu. En production, `SITE_ORIGIN` doit correspondre à l'adresse HTTPS utilisée dans le navigateur. Les champs d'identité et de traçabilité ne proviennent pas du client.

## Stockage et migrations

Le conteneur s'exécute avec **UID/GID 1000** et monte `./data:/app/data`. La base est définie par `DB_PATH=/app/data/myhome.sqlite`. En développement, `DB_PATH` peut désigner un autre fichier ; aucun fichier de base de production n'est incorporé à l'image.

Le wrapper `lib/sqlite.ts` conserve le contrat de statements préparés de l'application sur `node:sqlite` :

- clés étrangères activées ;
- `busy_timeout=5000`, soit une attente jusqu'à cinq secondes lors d'un verrouillage ;
- journal `DELETE` ;
- opérations groupées exécutées dans une transaction `BEGIN IMMEDIATE`, avec rollback de tout le batch si une instruction échoue.

Les migrations numérotées de `drizzle/` sont lues dans l'ordre au démarrage. Chaque fichier SQL est exécuté **entièrement** dans sa propre transaction, ce qui conserve les triggers. La table `app_migrations` enregistre le nom et le checksum SHA-256. Un checksum différent pour une migration déjà appliquée interdit le démarrage, sans réexécuter son SQL.

Pour modifier le schéma, ajouter une nouvelle migration SQL versionnée ; ne pas réécrire un fichier déjà appliqué. La génération `db:generate` a été retirée : les anciens snapshots Drizzle doivent être réalignés avant de rétablir une génération automatique. Le build ne modifie pas les migrations.

Tables de données : `users`, `households`, `memberships`, `records`, `barcodes`, `preferences`, `accounts`, `sessions`, `auth_rate_limits`, `push_settings`, `push_subscriptions`, `push_deliveries` et `app_migrations`. Les données des modules sont en JSON dans `records` ; les données partagées appartiennent au foyer et les préférences au couple foyer/utilisateur.

Les triggers SQLite contrôlent les références entre listes, produits et catégories lors de l'écriture. Ils interdisent les références entre foyers, les orphelins et les cycles de catégories. La table des codes-barres impose l'unicité `(household_id, code)` et conserve les zéros initiaux. Les clés Push privées restent dans une table serveur absente des réponses de lecture.

L'ordre d'une checklist est un tableau d'IDs `itemOrder` dans le JSON de sa liste. La commande `reorderChecklist` écrit une permutation exacte des tâches, en contrôlant atomiquement leur ensemble, la révision de la liste et l'adhésion active au foyer. Les formulaires de renommage préservent cet ordre serveur. Le client ignore les IDs supprimés, place les nouveaux éléments en fin de l'ordre de base, puis applique une partition stable pour afficher les cochés en bas (également dans les courses). Le tri A–Z/Z–A conserve ce regroupement et les déplacements sont bornés au groupe de même état. La recherche filtre uniquement l'affichage. Aucun changement de schéma n'est requis.

Un ?l?ment de checklist peut enregistrer un `linkedChecklistId` facultatif. L?API exige un parent et une cible de type checklist du m?me foyer, avec des IDs diff?rents. INSERT/UPDATE rev?rifient ces r?f?rences dans le SQL, en plus de la validation pr?alable ; une suppression concurrente ne peut donc recr?er un lien orphelin. Supprimer la cible enl?ve ses r?f?rences entrantes dans le m?me batch, en gardant le libell?, les autres champs et l?audit de cr?ation des ?l?ments parents, puis actualise leur audit de modification et leur r?vision. Le JSON suffit, sans migration. Il n?y a ni expansion r?cursive ni propagation de cases coch?es ; les r?f?rences entre listes diff?rentes peuvent former une boucle suivie manuellement. L?interface garde un historique de retour par foyer et pr?serve les pr?f?rences du tableau de bord.

La commande `clearCompleted` reçoit une liste et les couples ID/révision des éléments cochés confirmés par l'utilisateur. Un seul DELETE, avec CTE matérialisées, vérifie l'ensemble des cibles, leurs révisions, l'adhésion active et l'éligibilité de la liste avant tout effacement. Toute cible périmée ou étrangère bloque la suppression complète ; les nouveaux cochés hors de la requête restent. La purge concerne les courses et les checklists éphémères, conserve le catalogue, la liste et son audit/révision. Les références d'IDs supprimés dans `itemOrder` sont ignorées à la lecture. Le corps des commandes est borné à 1,2 Mo pour permettre les grands lots, tandis que les endpoints d'authentification gardent leur plafond de 150 ko.

Le commentaire temporaire d'un article de courses est stocké dans le champ JSON `comment` de son enregistrement `item`, avec une limite de 2 000 caractères. Les anciens articles sans ce champ restent compatibles. La quantité et le commentaire utilisent la commande `save` ciblée sur l'article, avec audit et contrôle de révision ; les références de liste et de produit ainsi que l'état coché sont conservés. Le schéma produit exclut ce commentaire. La suppression de l'article retire sa note ; aucune migration SQL n'est nécessaire.

Les lignes de courses affichent la quantité/unité uniquement lorsque la quantité est strictement supérieure à 1 ; la quantité affichée est éditable au clic. Les actions modification/suppression restent accessibles pour chaque article dans le menu ⋯, avec le même wrapper tactile et la même gestion du focus vers l'éditeur que les checklists. Les actions utilisent les commandes existantes ; aucune nouvelle écriture de catalogue n'est ajoutée.

## Build et supervision

L'association d'un code inconnu partage la comparaison exacte des noms de `lib/product-matching.ts` entre l'interface et l'API : trim, décomposition Unicode, suppression des accents et casse française. Un choix dans les suggestions transmet l'ID ; un nom tapé transmet le texte pour une résolution sur le catalogue actuel du foyer côté serveur. Un nom ambigu exige un choix, et une collision avec un code déjà lié à une autre cible est refusée avant les écritures. La forme originale des noms et les codes précédents sont conservés ; aucune migration n'est nécessaire.

Les suggestions Base UI sont placées à l'intérieur de la fenêtre Radix via un conteneur de portail dédié, pour rester dans son périmètre de focus et de défilement. Sans option active, Entrée valide le nom saisi ; avec une option active, elle sélectionne cette option sans soumettre en même temps le formulaire.

Dans le sélecteur d'association, `highlightItemOnHover={false}` évite les déplacements automatiques liés au survol, notamment avec les événements souris compatibles tactiles. Le handler interne `onMouseUp` des suggestions est neutralisé via `preventBaseUIHandler()` : un relâchement après défilement ne choisit plus une option surlignée sans clic. Les handlers de clic et de clavier de Base UI restent utilisés, avec la valeur et l'ID du produit.

`npm run build` compile Next.js avec `output: standalone`, copie les assets publics et génère le bundle autonome `runtime/reminders.mjs` avec esbuild.

`scripts/nas-entrypoint.mjs` démarre deux processus : le serveur standalone et le planificateur. Si l'un s'arrête de façon inattendue, l'entrée arrête l'autre et termine le service ; la politique Compose `restart: unless-stopped` peut alors redémarrer l'ensemble. Les signaux d'arrêt sont transmis aux deux processus.

Le contrôle `GET /api/health` est utilisé par Docker. Le port du conteneur est 3000, publié uniquement sur `127.0.0.1:3080` du NAS. Le proxy DSM fournit l'adresse HTTPS configurée dans `SITE_ORIGIN`.

Une seule instance du conteneur est prévue. Pour sauvegarder, arrêter le projet puis copier tout `data/` et le fichier `.env`. À la mise à jour, conserver ces éléments et reconstruire l'image. Une restauration après changement de schéma doit utiliser une sauvegarde compatible avec la version applicative.

## Synchronisation

Le mode cuisine alterne uniquement entre les deux listes choisies dans les préférences personnelles. Un minuteur relatif réinitialisable accorde le délai complet après un swipe, une interaction ou la fin d'une mutation ; les pauses pour saisie/menu/fenêtre/application masquée sont surveillées toutes les 250 ms à partir de l'échéance, puis suivies d'un délai complet. Les swipes horizontaux n'annulent pas le défilement vertical ; des boutons permettent aussi la navigation au clavier. Le menu mobile est contrôlé par l'application et fermé lors de la navigation.

Les déclencheurs de menus Radix conservent leurs handlers souris/clavier, ARIA et refs. Un relais écarte seulement le handler `pointerdown` tactile de Radix, qui ouvrait le menu et empêchait le défilement. Des observateurs passifs valident le tap à la fin du geste et rejettent déplacement, annulation ou plusieurs doigts.

`getElectricity` et `getNextElectricityTransition` partagent la fusion des intervalles hebdomadaires en Europe/Paris. La prochaine bascule est calculée aux frontières effectives et aux changements d'offset du fuseau, sans parcours de chaque minute ni création répétée de formatter. Le tableau de bord affiche l'état futur, la date/heure locale et le délai réel, actualisés toutes les 15 secondes.

Les données sont persistées sur le NAS. Les mutations sont ciblées par élément. Le client relit l'état toutes les **2,5 secondes** lorsque l'application est visible, après chaque mutation et au retour sur la fenêtre. Cette synchronisation se fait donc en quelques secondes. Une modification fondée sur une ancienne révision est rejetée avec HTTP 409.

Le navigateur conserve des états propres à l'appareil, comme le foyer actif et les marqueurs des rappels locaux. La visibilité des cartes électricité/poubelles utilise uniquement la clé `myhome-device-dashboard` du `localStorage`, avec les deux cartes visibles par défaut. Un store à snapshots immuables/cachés se synchronise entre onglets ; un stockage inaccessible laisse les choix utilisables en mémoire pour la session. Le rendu serveur ne lit pas ce stockage et les cartes attendent la lecture initiale côté client avant de devenir visibles. Une carte seule occupe la ligne ; aucune zone n'est rendue si les deux sont masquées. Ces réglages ne modifient ni les règles du foyer, ni les notifications, ni les préférences serveur.

Les autres préférences de tableau de bord (listes, disposition, rotation, caméra, couleurs) restent en base, par utilisateur et par foyer. Il n'existe pas de file d'écritures hors ligne synchronisée au retour du réseau.

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

Les zones `.shopping-items` et `.task-items` gardent un défilement interne limité à `56vh`, avec `overscroll-behavior: auto` pour autoriser le relais natif vers la page sur les listes courtes ou à leurs extrémités. Les handlers de rotation et de menu ne bloquent pas le geste vertical. Le relais dans un même geste dépend du navigateur/système, comme le précise le [projet CSSWG](https://drafts.csswg.org/css-overscroll-1/#scroll-chaining).

`npm test` couvre le domaine (dont la prochaine bascule électrique et les changements d'heure), les minuteurs de rotation avec horloge simulée, les gestes swipe/tap/scroll/annulation, les préférences locales (isolation des appareils, SSR, chargement, persistance, changements entre onglets et stockage bloqué), les migrations, la réouverture de SQLite, les rollbacks, les références, les droits, l'authentification, les checklists, le regroupement des cochés et la validation des quantités/commentaires des articles. `npm run test:api` démarre une instance standalone avec une base temporaire, vérifie les comptes, les sessions, le partage et l'isolation des foyers, les rôles, les codes-barres, l'ordre et les libellés des checklists, l'édition des articles sans modification du catalogue ni propagation aux autres lignes, la purge atomique des terminés et la protection des listes réutilisables, les conflits de révision, les préférences et la persistance après un arrêt/redémarrage. Le HTML de démonstration est vérifié pour la position des commandes, la quantité visible et les menus d'actions de chaque type de liste.

La compilation Next.js en production et la validation de la configuration Docker Compose ont réussi sur le poste de préparation. Les résultats définitifs des suites de tests sont précisés à la livraison.

`npm run test:browser` compile une fixture contenant le vrai sélecteur et le vrai Dialog, sert le CSS de production sur localhost et utilise un navigateur Chromium isolé. Les 10 scénarios contrôlent l'élément réellement sous le pointeur, son ID/nom sélectionné, le scroll tactile/molette avec et sans filtre, la fenêtre défilante, les événements de relâchement compatibles et le clavier. Les gestes sont injectés par le protocole du navigateur ; le test de relâchement compatible reste distinct des gestes tactiles. Il utilise uniquement des produits fictifs et conserve les résultats/captures dans un dossier ignoré.

Le moteur Docker local est arrêté : aucune construction ni exécution de l'image Docker n'a été validée. Aucun essai direct sur le Synology n'a été effectué. Le navigateur de QA intégré est indisponible ; le rendu, les caméras, la douchette et la réception des notifications doivent être vérifiés sur les appareils réels.

Les notes sont en texte simple ; dessin et pièces jointes ne sont pas intégrés. Aucun envoi d'email de validation ni parcours de récupération de mot de passe n'est configuré.

L'ancienne archive Sites est conservée à titre historique, hors du package NAS. Les données Cloudflare de cette ancienne version ne sont pas importées automatiquement dans la nouvelle base.

`npm run test:browser:checklists` ouvre le serveur standalone sur localhost avec un profil et une base temporaires. Les interactions se font dans le mode d?monstration de l?application r?elle, ? la souris puis avec des ?v?nements tactiles : cr?ation/?dition/retrait du lien, navigation imbriqu?e et retour, cases ind?pendantes, retour au mode cuisine, puis suppression de cible. Les captures et r?sultats restent dans `.sites-runtime/checklist-links-browser/`.
