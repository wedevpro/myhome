# Installer MyHomeIA sur votre Synology

Ce package vise le DS920+ avec Container Manager, en architecture `linux/amd64`. La version de DSM communiquée est **7.4.1-90080**. Il construit une application Node.js 24 autonome avec SQLite, des comptes propres à MyHomeIA et un planificateur de rappels intégré. Aucun compte Cloudflare ou ChatGPT n'est requis pour cette installation.

La base, les comptes et les clés de notification restent dans le dossier `data/`. Le planificateur s'exécute dans le conteneur : aucun service de cron ni secret de planification externe n'est à créer. Le NAS et le conteneur doivent rester allumés pour envoyer les rappels.

La compilation Next.js de production et la validation de Docker Compose ont réussi sur le poste de préparation. Le moteur Docker local étant arrêté, l'image n'a pas été construite ni exécutée ; aucun test direct sur votre NAS ni QA dans le navigateur intégré n'a été effectué. Les résultats des suites de tests sont précisés à la livraison. Les [instructions de développement](app/README.md) et l'[architecture détaillée](app/docs/ARCHITECTURE.md) sont fournies dans le package.

## 1. Copier le package

Installez **Container Manager** depuis le Centre de paquets. Décompressez `myhomeia-synology.zip` dans le dossier :

```text
/volume1/docker/myhomeia/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── GUIDE-SYNOLOGY.md
├── app/
└── data/                 à créer
```

Le dossier `app/` doit être à côté du Dockerfile, sans niveau supplémentaire introduit par la décompression. Vérifiez que les fichiers commençant par un point ont également été copiés. L'archive de publication Sites `myhomeia-site.tar.gz` n'est pas le package à installer ici.

Dupliquez `.env.example` en `.env` puis remplacez `SITE_ORIGIN` par l'adresse HTTPS définitive de MyHomeIA, par exemple `https://maison.votredomaine.fr`. Ne mettez pas de slash final. Conservez `AUTH_COOKIE_SECURE=true`.

## 2. Préparer le dossier de données

Le conteneur utilise l'UID **1000** et le GID **1000**. Le dossier `data/` doit être accessible en écriture pour ces identifiants. Une autorisation accordée à votre seul compte DSM ne garantit pas cet accès.

Dans DSM, activez SSH dans **Panneau de configuration → Terminal et SNMP → Terminal**, puis connectez-vous avec un compte administrateur. Exécutez :

```sh
sudo mkdir -p /volume1/docker/myhomeia/data
sudo chown 1000:1000 /volume1/docker/myhomeia/data
sudo chmod 750 /volume1/docker/myhomeia/data
```

Ces commandes concernent uniquement ce dossier, pas l'ensemble du partage `docker`. Les dossiers parents doivent permettre au conteneur de les traverser. Si les journaux indiquent `Permission denied` malgré ces réglages, vérifiez aussi les permissions héritées dans **File Station → Propriétés → Permission** du dossier concerné. Conservez l'exécution du conteneur avec l'UID 1000. Vous pourrez désactiver SSH une fois la préparation terminée.

## 3. Créer le projet Container Manager

Ouvrez **Container Manager → Projet → Créer** : nommez le projet `myhomeia`, choisissez `/volume1/docker/myhomeia` comme chemin et sélectionnez le fichier `docker-compose.yml` fourni. Laissez l'option de portail Web Station désactivée : le proxy sera configuré directement dans DSM. Terminez l'assistant.

Sélectionnez le projet puis **Action → Construire**. La première construction télécharge Node.js et les dépendances ; le NAS doit avoir accès à Internet. Lancez ensuite **Action → Démarrer** si le projet ne démarre pas automatiquement. Consultez ses journaux en cas d'erreur. Cette procédure reprend le fonctionnement documenté dans [Projet — Container Manager](https://kb.synology.com/fr-fr/DSM/help/ContainerManager/docker_project?version=7).

Le service écoute uniquement sur `127.0.0.1:3080` du NAS. Vous ne pourrez donc pas ouvrir directement `http://IP-DU-NAS:3080` depuis votre tablette. C'est le proxy HTTPS de l'étape suivante qui donnera accès à l'application.

## 4. Configurer le proxy HTTPS

Faites pointer le nom de domaine choisi vers votre NAS, y compris depuis votre réseau local, et associez un certificat valide à ce nom dans **Panneau de configuration → Sécurité → Certificat**.

Ouvrez **Panneau de configuration → Portail de connexion → Avancé → Proxy inversé → Créer** et configurez :

| Réglage | Source | Destination |
| --- | --- | --- |
| Protocole | HTTPS | HTTP |
| Nom d'hôte | `maison.votredomaine.fr` | `127.0.0.1` |
| Port | `443` | `3080` |

Le domaine de la source doit être exactement celui de `SITE_ORIGIN`. Dans les en-têtes de requête personnalisés, transmettez `Host` et `X-Forwarded-Host` avec ce domaine et `X-Forwarded-Proto` avec la valeur `https`. La connexion entre le proxy et le conteneur reste locale. Les paramètres de proxy sont décrits par [Synology — Portail de connexion, Avancé](https://kb.synology.com/fr-fr/DSM/help/DSM/AdminCenter/system_login_portal_advanced?version=7).

Ouvrez alors l'adresse HTTPS, créez votre compte MyHomeIA et créez ou rejoignez un foyer. Les comptes DSM ne remplacent pas les comptes de l'application. Pour un accès exclusivement à la maison, il suffit que le domaine soit résolu sur votre réseau local ; aucune redirection de port Internet n'est nécessaire.

La caméra et les notifications web demandent une adresse HTTPS reconnue par l'appareil. Activez les notifications depuis l'application sur chaque appareil souhaité. Sur iPhone/iPad avec iOS/iPadOS 16.4 ou supérieur, installez d'abord l'application sur l'écran d'accueil. L'envoi des notifications demande aussi que le NAS puisse joindre les services Push sur Internet. [Documentation WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Vérifier le démarrage

Le contrôle de santé interroge `/api/health` dans le conteneur. Dans Container Manager, vérifiez qu'il fonctionne sans redémarrages répétés. Depuis une session SSH sur le NAS, ce contrôle peut également être lancé :

```sh
curl --fail http://127.0.0.1:3080/api/health
```

En cas d'échec : consultez les journaux du conteneur, les permissions de `data/`, puis la valeur de `SITE_ORIGIN`. Si la connexion ne persiste pas, utilisez bien l'adresse HTTPS prévue avec son certificat valide.

## Sauvegarder et restaurer

Dans Container Manager, sélectionnez le projet et faites **Action → Arrêter**. Quand le conteneur est arrêté, copiez **tout le dossier `data/`** et le fichier `.env` vers votre sauvegarde, puis redémarrez le projet. Cette copie à l'arrêt préserve aussi les éventuels fichiers journaux SQLite ; ne copiez pas uniquement `myhomeia.sqlite` pendant que l'application fonctionne.

La sauvegarde contient les comptes, les données des foyers et les clés Push. Pour restaurer, arrêtez le projet, remplacez `data/` par sa sauvegarde et rétablissez ses permissions pour `1000:1000`, ainsi que le fichier `.env`, puis redémarrez. Les données de l'ancienne publication Cloudflare ne sont pas importées automatiquement dans cette installation.

## Ajouter et nettoyer les listes

Les champs **Ajouter un produit…** et **Ajouter une tâche…** se trouvent maintenant en haut de leur liste, avec **Scanner un code-barres** pour les courses. Les éléments des longues listes défilent dans leur propre zone ; les commandes d'ajout restent au-dessus.

Les listes laissent le défilement passer à la page lorsqu'elles sont vides ou courtes, ou à leurs extrémités. Le navigateur gère ce relais ; selon l'appareil, un nouveau mouvement peut être nécessaire après avoir atteint le bord.

Dans les courses et toutes les checklists, les éléments cochés passent en bas et les éléments à faire restent en haut. Une tâche éphémère cochée est désormais conservée jusqu'à sa suppression : vous pouvez la décocher si besoin.

Les libellés des éléments sont affichés en **16 px** sur les pages de listes et le tableau de bord classique. En mode cuisine, ils passent à **22 px**, ou **20 px** sur les petits écrans, avec retour à la ligne des textes longs.

Le bouton **Supprimer les éléments terminés** est disponible pour les listes de courses et les checklists **éphémères**, avec confirmation et indication du nombre d'éléments concernés. Il s'applique à toute la liste, même si un filtre est actif. Les éléments à faire et les fiches produits sont conservés. Une modification concurrente d'un élément visé bloque l'opération entière ; actualisez la liste et relancez-la. Les éléments cochés après l'ouverture de la confirmation restent dans la liste. Les checklists réutilisables conservent leurs éléments pour la prochaine utilisation.

## Associer un code-barres inconnu

Après un scan caméra, une douchette ou la saisie manuelle d'un code inconnu, la fenêtre **Un nouveau code-barres** propose un seul champ **Nom du produit** avec auto-complétion. Saisissez le nom ou choisissez une suggestion, puis validez avec **Ajouter à la liste**.

Sur mobile, faites défiler les suggestions puis touchez le produit souhaité. Le défilement seul ne sélectionne pas de produit. Au clavier, les flèches et Entrée permettent de choisir une suggestion.

Si le nom complet correspond à un produit du foyer, sans tenir compte des majuscules, des accents ni des espaces aux extrémités, le code est ajouté à ce produit. Un nom inconnu crée un produit avec le nom saisi. Les suggestions permettent aussi de choisir directement un produit ; une correspondance partielle seule ne suffit pas à l'associer. Si plusieurs produits ont le même nom, choisissez une suggestion pour préciser lequel. Si un produit choisi a été supprimé, faites un nouveau choix avant de valider.

## Modifier un article de la liste de courses

Le bouton **⋯** de chaque article ouvre les actions **Modifier la quantité et la note** et **Supprimer l’article**. La quantité et son unité s'affichent hors du menu uniquement lorsque la quantité est strictement supérieure à 1 ; cliquer sur la quantité affichée ouvre aussi l'édition. Le menu reste accessible quelle que soit la quantité. Les quantités décimales sont acceptées ; la valeur doit être supérieure à zéro, dans la limite de 10 000. Pour retirer une note, videz son champ puis enregistrez.

La note s'affiche sous le nom de l'article et est partagée avec les membres du foyer. Elle appartient uniquement à cette ligne de courses : elle ne modifie pas la fiche produit et n'est pas recopiée lors d'un nouvel ajout du même produit, dans cette liste ou une autre. Cocher l'article conserve sa note ; supprimer la ligne la supprime également. Ces commandes sont disponibles dans les listes de courses, le tableau de bord et le mode cuisine.

## Afficher une liste de courses ou une checklist

L'en-tête de chaque encart affiche le **nom de la liste en cours**, aligné avec son icône, sans descriptif ni liste déroulante. Sur les pages Courses et Checklists, les boutons avec icônes au-dessus de l'encart permettent de changer de liste. Sur le tableau de bord et en mode cuisine, les listes affichées se choisissent dans **Paramètres → Mon tableau de bord**. Le compteur des articles à acheter reste visible dans l'en-tête des courses.

## Trier, déplacer et filtrer une checklist

Ces commandes sont disponibles dans les checklists, sur le tableau de bord et en mode cuisine :

- **A–Z** et **Z–A** trient toute la checklist par nom, avec un classement français tenant compte des nombres.
- Le bouton **⋯** de chaque élément ouvre son menu : **Modifier l’élément**, **Monter d'une position**, **Choisir la position**, **Descendre d'une position** et **Supprimer cet élément**. L'éditeur permet de modifier le libellé et de choisir une checklist liée facultative. Les déplacements se font parmi les éléments du même état (à faire ou terminés), pour garder les éléments cochés en bas.
- **Filtrer les éléments…** recherche dans les noms sans tenir compte des majuscules ni des accents. Le compteur indique le nombre de résultats ; effacez le filtre pour revoir toute la checklist.

L'ordre est enregistré sur le NAS et partagé avec les membres du foyer. Le tri s'applique séparément aux éléments à faire et terminés, même lorsqu'un filtre est actif. Les nouveaux éléments arrivent après les autres éléments à faire, avant les éléments terminés ; le filtre ne supprime ni ne modifie les tâches. Modifier un libellé ou renommer la liste conserve l'ordre enregistré. « Tout décocher » remet une checklist réutilisable à zéro. En mode cuisine avec rotation, un menu, une fenêtre ouverte ou un champ de saisie actif suspend le changement de liste.

## Lier un élément à une autre checklist

Dans **Valise**, cliquez sur **Ajouter une checklist liée**, choisissez **Trousse de toilette**, puis confirmez le libellé à afficher dans Valise. Pour lier un élément déjà présent, utilisez **⋯ → Modifier l’élément → Checklist liée (facultatif)**. Le choix **Aucune** retire uniquement le lien.

Le libellé lié, accompagné d'une icône de lien, ouvre le contenu de Trousse de toilette. Le bouton **Retour** retrouve la liste ou le tableau de bord d'origine. Les liens peuvent aussi être suivis depuis le mode cuisine, sans modifier les listes choisies dans vos paramètres. Les cases à cocher de Valise et de Trousse de toilette restent indépendantes ; aucun détail n'est recopié dans Valise.

La cible doit être une autre checklist du même foyer. Son renommage conserve le lien et votre libellé. Si elle est supprimée, les éléments qui la référencent restent dans leurs listes avec leur libellé et leur état coché ; seul leur lien est retiré. Supprimer Valise ne supprime pas une checklist vers laquelle elle pointe.

## Configurer le tableau de bord en mode cuisine

Dans **Paramètres → Mon tableau de bord**, choisissez votre **Liste de courses** et votre **Checklist**, puis **Une liste à la fois, avec rotation** pour les afficher en alternance en mode cuisine. La rotation concerne uniquement ces deux listes ; le délai reste réglable de 5 à 300 secondes. Si un type de liste est absent du foyer, seule l'autre liste est affichée. Les choix sont personnels à votre compte et à ce foyer.

Le mode cuisine agrandit les textes des cartes d'électricité et de poubelles : état heures pleines/creuses, prochaine sortie, horaire du rappel et décompte des jours.

En rotation, **balayez horizontalement la liste** pour afficher immédiatement l'autre liste, ou utilisez les flèches précédente/suivante. Le défilement vertical reste disponible pour les longues listes. Un swipe ou une action (ajout, coche, modification, suppression, tri, filtre…) relance le délai complet avant le prochain changement. La rotation attend pendant un enregistrement, un menu, une fenêtre ou une saisie ; après une pause atteignant l'échéance, elle accorde de nouveau le délai complet.

La carte électrique indique la **prochaine bascule vers les heures creuses ou pleines**, avec son horaire et le temps restant. Pour une bascule un autre jour, elle précise demain ou la date. Le calcul suit les horaires du foyer en Europe/Paris, y compris les plages de nuit, les chevauchements et les changements d'heure. L'indication s'actualise avec le tableau de bord, toutes les 15 secondes.

Sur mobile, choisir une page ferme automatiquement le menu latéral. Pour ouvrir un menu ⋯, touchez puis relâchez le bouton ; commencer un défilement sur ce bouton laisse défiler la liste sans ouvrir son menu.

Le bouton **Retour de l'appareil** retrouve l'écran précédent, y compris la liste sélectionnée et les checklists liées. Si un menu ou une fenêtre est ouvert, Retour le ferme d'abord. Sans écran précédent, vous restez dans l'application. Recharger la page ou changer de foyer démarre un nouvel historique ; revenir en arrière conserve les modifications faites dans les listes.

## Afficher ou masquer les cartes du tableau de bord

Dans **Paramètres → Tableau de bord sur cet appareil**, activez ou désactivez séparément **Afficher la carte électricité** et **Afficher la carte poubelles**. Les deux cartes sont visibles par défaut. Le changement est immédiat, sans bouton d'enregistrement, et concerne le tableau de bord classique comme le mode cuisine.

Si une seule carte est affichée, elle prend toute la largeur de sa ligne. Si les deux sont masquées, les listes remontent à la place de cette ligne. Les pages Électricité/Poubelles et les rappels restent disponibles.

Ces choix restent mémorisés **dans ce navigateur sur cet appareil**, pour tous les foyers qui y sont consultés. Vous pouvez donc garder les deux cartes sur la tablette et les masquer sur le téléphone. Ils ne sont pas synchronisés avec les préférences du compte. Effacer les données du navigateur rétablit l'affichage par défaut.

## Choisir le mode d'affichage

MyHomeIA s'affiche en mode clair par défaut, même si l'appareil est configuré en sombre. Dans **Paramètres → Apparence → Mode d'affichage**, choisissez **Mode Clair**, **Mode Sombre** ou **Appliquer le mode de l'appareil**.

Le choix s'applique immédiatement et reste mémorisé dans ce navigateur sur cet appareil. Le troisième choix suit automatiquement les changements d'apparence de l'appareil. Vous pouvez ainsi garder la tablette de cuisine en clair et le téléphone en sombre. Les couleurs personnalisées des heures d'électricité sont conservées.

## Mettre à jour

### Avec le script de mise à jour

Copiez [METTRE-A-JOUR-SYNOLOGY.sh](METTRE-A-JOUR-SYNOLOGY.sh) sur le NAS **hors de l'installation**, par exemple dans `/volume1/docker/`. Déposez aussi le nouveau ZIP dans `/volume1/docker/myhomeia-synology.zip`. Le script est inclus à la racine du package ; vous pouvez le copier depuis le PC avant de lancer la mise à jour.

En SSH, exécutez :

```sh
sudo sh /volume1/docker/METTRE-A-JOUR-SYNOLOGY.sh /volume1/docker/myhomeia-synology.zip
```

Le chemin du ZIP est facultatif si le fichier est à cet emplacement. Le script utilise `/volume1/docker/myhomeia` comme installation. Il :

1. Vérifie le package, le projet/service Compose existant et le volume `data/` réellement monté.
2. Arrête le conteneur avant de copier `.env` et tout `data/`, pour sauvegarder SQLite et ses fichiers associés de manière cohérente.
3. Conserve la sauvegarde dans `/volume1/docker/myhomeia-backups/AAAAMMJJ-HHMMSS-PID/`, avec accès restreint. L'ancien dossier `app/` y est également déplacé avant remplacement, afin de retirer les fichiers applicatifs disparus du nouveau package.
4. Extrait le ZIP dans l'installation et recopie `.env` puis le contenu de `data/`, en conservant leurs permissions et sans créer `data/data`.
5. Lance `up -d --build --force-recreate myhomeia` avec le nom du projet existant, puis attend le contrôle de santé du conteneur pendant au maximum 120 secondes.

Le script détecte `docker compose` ou `docker-compose`. Il ne demande pas de recopier la sauvegarde manuellement et la conserve après succès. Le fichier `SAUVEGARDE-TERMINEE.txt` confirme que la copie de `.env` et `data/` a abouti avant remplacement. Les valeurs de `.env` ne sont pas affichées.

En cas d'échec avant le remplacement des sources, le conteneur précédemment actif est redémarré. Après le début du remplacement ou du déploiement, le script conserve la sauvegarde et affiche le diagnostic à consulter ; il ne restaure pas automatiquement une base qui aurait déjà été migrée. Après une interruption brutale, le dossier `.myhomeia-update.lock` peut rester présent : vérifiez qu'aucune mise à jour n'est en cours avant de le retirer.

Pour une installation différente, les variables `MYHOMEIA_DIR` et `MYHOMEIA_BACKUP_DIR` permettent de changer les chemins. Elles doivent désigner respectivement l'installation existante et un dossier de sauvegarde situé hors de celle-ci.

### Mise à jour manuelle

Sauvegardez d'abord comme ci-dessus. Arrêtez le projet, remplacez les fichiers applicatifs par ceux du nouveau package et **conservez `data/` et votre `.env`**. Dans Container Manager, reconstruisez le projet puis démarrez-le. Si nécessaire, utilisez l'action de redéploiement/recréation des conteneurs pour que la nouvelle image soit prise en compte ; un simple redémarrage ne reconstruit pas l'image.

Les migrations SQL sont exécutées intégralement au démarrage et suivies avec un checksum. Ne modifiez pas une migration déjà appliquée ; les mises à jour ajoutent de nouveaux fichiers versionnés. Conservez la sauvegarde d'avant mise à jour : revenir à une ancienne image après une modification du schéma peut nécessiter de restaurer aussi cette sauvegarde.

Pour une première installation en SSH au lieu de l'interface, utilisez explicitement le nom de projet `myhomeia` :

```sh
cd /volume1/docker/myhomeia
sudo docker compose -p myhomeia up -d --build
sudo docker compose -p myhomeia ps
sudo docker compose -p myhomeia logs --tail=100 myhomeia
```

Selon la version de Container Manager, la commande peut être `docker-compose` au lieu de `docker compose`. Le projet doit conserver une seule instance du conteneur : sa base SQLite et son planificateur sont partagés dans cette instance.

### Conflit « container name /myhomeia is already in use »

Ce message signifie qu'un conteneur porte déjà le nom `myhomeia`. Si l'installation a été créée par Container Manager, son nom de projet Compose peut différer de celui déduit par la commande SSH. `--force-recreate` ne reprend pas un conteneur appartenant à un autre projet. Il faut utiliser le nom de projet déjà enregistré sur le conteneur, avec `-p`. [Noms de projets Compose](https://docs.docker.com/compose/how-tos/project-name/).

Vérifiez d'abord le dossier contenant réellement la base existante :

```sh
sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' myhomeia
```

Le chemin affiché doit correspondre au dossier `data/` de cette installation. Depuis **le même dossier que lors de l'installation**, après avoir conservé votre `.env` et sauvegardé `data/`, exécutez le bloc suivant. Adaptez le chemin si votre installation n'est pas dans `/volume1/docker/myhomeia` :

```sh
cd /volume1/docker/myhomeia
projet=$(sudo docker inspect --format '{{with index .Config.Labels "com.docker.compose.project"}}{{.}}{{end}}' myhomeia)
service=$(sudo docker inspect --format '{{with index .Config.Labels "com.docker.compose.service"}}{{.}}{{end}}' myhomeia)
if [ -n "$projet" ] && [ "$service" = "myhomeia" ]; then
  sudo docker compose -p "$projet" up -d --build --force-recreate
else
  echo "Projet ou service inattendu : projet=$projet service=$service. Conservez le conteneur pour diagnostic."
fi
```

Ce bloc récupère les labels Compose existants et met à jour ce projet. Il ne supprime pas le dossier de données. Si le message « Projet ou service inattendu » apparaît, relevez ses valeurs avant toute autre action. Il n'est pas nécessaire de supprimer ou de renommer le conteneur pour résoudre le cas d'un nom de projet différent.

## Correctif du blocage après connexion

L'ancienne version pouvait afficher une erreur serveur après inscription ou connexion : la ligne utilisateur SQLite était transmise dans un format refusé par React. Le correctif normalise ces données avant le rendu. Il ne modifie pas le schéma, les comptes, les mots de passe ou les sessions existantes.

Pour installer le correctif, arrêtez le projet et sauvegardez `data/`. Remplacez les fichiers applicatifs par ceux de la nouvelle archive **en conservant `data/` et votre `.env`**. Reconstruisez et recréez le conteneur pour charger le nouveau code ; un simple redémarrage de l'ancienne image ne suffit pas. En SSH, utilisez le bloc ci-dessus : il récupère le nom du projet existant avant de lancer la mise à jour.

Cette commande reconstruit l'image, recrée le service et conserve le dossier de données monté. [Documentation Docker Compose](https://docs.docker.com/reference/cli/docker/compose/up/).

Rechargez ensuite l'adresse habituelle dans votre navigateur. Votre compte existant doit fonctionner. Si vous souhaitez fermer la session, la nouvelle page `/deconnexion` reste accessible même lorsque le tableau de bord est en erreur : ajoutez `/deconnexion` à l'adresse de MyHomeIA et utilisez son bouton. Vous n'avez pas besoin de recréer un compte ni de supprimer la base.
