# MyHomeIA

Application web installable pour le foyer : courses, checklists, notes, contacts, horaires d'électricité et sorties de poubelles. Le mode cuisine propose un tableau de bord destiné à une tablette murale en paysage.

Cette version fonctionne de manière autonome sur votre NAS : **Next.js, Node.js et SQLite**, avec des comptes MyHomeIA par email et mot de passe. Les membres partagent les données de leurs foyers et conservent leurs préférences de tableau de bord.

Pour installer le package sur le DS920+, suivez [GUIDE-SYNOLOGY.md](../GUIDE-SYNOLOGY.md). Le détail des fonctionnalités et du stockage est dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Installation sur Synology

Décompressez `myhomeia-synology.zip` dans `/volume1/docker/myhomeia`. Le Dockerfile, le fichier Compose et le dossier `app/` doivent être au même niveau. Copiez le modèle [../.env.example](../.env.example) en `../.env`, configurez votre adresse HTTPS puis préparez les permissions de `data/` comme indiqué dans le guide.

Le conteneur utilise **Node.js 24**, un utilisateur non privilégié UID/GID 1000 et le volume `./data:/app/data`. SQLite est stocké dans `/app/data/myhomeia.sqlite`. Le port 3080 est lié uniquement à l'interface locale du NAS ; le proxy HTTPS de DSM fournit l'accès aux appareils.

Le serveur web et le planificateur de rappels démarrent ensemble. Aucune planification externe ni compte ChatGPT n'est nécessaire.

## Développement local

Node.js **22.13 ou supérieur** est requis ; Node.js 24 est la version du conteneur. Depuis le dossier `app/` :

```sh
npm ci
```

Créez `app/.env.local` avec ces valeurs pour le développement sur la boucle locale :

```dotenv
SITE_ORIGIN=http://127.0.0.1:3000
AUTH_COOKIE_SECURE=false
DB_PATH=./data/dev.sqlite
```

Puis lancez :

```sh
npm run dev
```

Ouvrez `http://127.0.0.1:3000`. Créez un compte avec une adresse email et un mot de passe d'au moins **12 caractères**, puis créez ou rejoignez un foyer. L'aperçu sans connexion contient uniquement des exemples temporaires. Les migrations de la base locale s'appliquent automatiquement lors de son ouverture.

Le réglage HTTP ci-dessus concerne uniquement le développement local. La production utilise une origine HTTPS explicite dans `SITE_ORIGIN` et des cookies de session sécurisés.

## Construire, démarrer et vérifier

| Commande dans `app/` | Fonction |
| --- | --- |
| `npm ci` | Installe les versions du lockfile. |
| `npm run dev` | Lance Next.js en développement. |
| `npm run build` | Compile Next.js en standalone, copie les assets et génère `runtime/reminders.mjs`. |
| `npm start` | Démarre le serveur standalone et le processus supervisé de rappels. Configurer au préalable l'environnement de production, notamment `SITE_ORIGIN`. |
| `npm test` | Vérifie les calculs de domaine, l'authentification et le stockage SQLite sur des bases de test isolées. |
| `npm run test:api` | Démarre une instance standalone isolée, teste les API et vérifie la persistance après redémarrage. Nécessite un build préalable. |

Ordre de vérification :

```sh
npm test
npm run build
npm run test:api
```

Le test API choisit un port disponible et utilise une base temporaire ; il ne modifie pas les données du foyer. Le contrôle de santé est `GET /api/health`.

La compilation Next.js de production et la validation du fichier Compose ont réussi sur le poste de préparation. Les résultats détaillés des suites de tests sont indiqués à la livraison. Le moteur Docker local étant arrêté, la construction et l'exécution de l'image Docker n'ont pas été testées ; aucun essai direct sur le NAS ni QA dans le navigateur intégré n'a été effectué. Caméras, douchette et réception Push restent à vérifier sur les appareils réels.

## Données, mises à jour et rappels

La base SQLite utilise les clés étrangères, des transactions pour les opérations groupées, `journal_mode=DELETE` et `busy_timeout=5000`. Chaque migration SQL complète est appliquée au démarrage dans une transaction, puis enregistrée avec son checksum. Une migration déjà appliquée ne doit jamais être modifiée : ajoutez une nouvelle migration SQL versionnée dans `drizzle/`.

La commande `db:generate` a été retirée. Ne régénérez pas automatiquement les migrations à partir des anciens snapshots Drizzle tant qu'ils n'ont pas été réalignés avec le schéma actuel.

Pour sauvegarder, arrêtez le projet et copiez tout `data/` ainsi que votre `.env`. Pour mettre à jour, conservez ces deux éléments et reconstruisez le conteneur. Le [guide Synology](../GUIDE-SYNOLOGY.md) décrit la procédure.

Le planificateur vérifie les rappels au démarrage puis environ chaque minute. Les notifications peuvent être reçues avec l'application fermée si l'appareil est abonné, si le NAS reste en fonctionnement et s'il dispose d'un accès Internet. Activez les notifications sur chaque appareil ; sur iPhone/iPad, ajoutez l'application à l'écran d'accueil.

La synchronisation des données utilise une actualisation toutes les **2,5 secondes**. Les notes sont en texte simple. Les données de l'ancienne publication Cloudflare ne sont pas importées automatiquement. L'ancienne archive Sites est conservée à titre historique dans le workspace, hors du package Synology.

## Organisation

- `app/api/` : authentification, lectures, commandes et notifications.
- `components/` : interface, formulaires et scan ZXing/douchette.
- `lib/sqlite.ts` : stockage natif Node.js, transactions et migrations.
- `lib/auth.ts`, `lib/auth-crypto.ts` : comptes et sessions.
- `lib/model.ts`, `lib/push.ts` : calculs des horaires, occurrences et envois Push.
- `drizzle/` : migrations SQL exécutées au démarrage.
- `scripts/build-nas.mjs`, `scripts/nas-entrypoint.mjs`, `scripts/reminder-worker.ts` : build et supervision.
- `public/` : icônes, manifeste PWA et service worker.
