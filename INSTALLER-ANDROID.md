# Installer myHome et ses widgets sur Android

L'application **myHome Android** utilise le même serveur, les mêmes comptes et les mêmes foyers que l'application web sur le NAS. Elle nécessite **Android 8.0 ou ultérieur** et une adresse **HTTPS avec un certificat valide**. Elle ne contient ni adresse de NAS, ni compte préconfiguré.

## Première installation

La version **1.0.7** adopte le nom **myHome** et l'identifiant Android **`fr.myhome.android`**. Si une version antérieure est déjà installée, Android considère myHome comme une autre application : renseignez à nouveau le serveur, connectez-vous et recréez les widgets. Les comptes et listes restent sur le NAS. **Mettez le NAS à jour avec le package renommé avant de connecter cette nouvelle application**, car le nom du cookie de session change également.

1. Mettez d'abord le NAS à jour avec le nouveau `myhome-synology.zip`, selon [GUIDE-SYNOLOGY.md](GUIDE-SYNOLOGY.md). Les sources web de cette livraison permettent d'ouvrir la liste et le formulaire demandés par le widget.
2. Copiez `myhome-android.apk` sur le téléphone ou la tablette. Ouvrez ce fichier et autorisez l'installation depuis cette source si Android le demande.
3. Ouvrez **myHome**, renseignez l'adresse HTTPS exacte utilisée pour accéder au NAS, puis connectez-vous avec votre compte habituel.
4. Depuis l'écran d'accueil Android, faites un appui long, choisissez **Widgets**, puis **myHome**. Deux widgets sont disponibles : la liste complète et **myHome · Scan rapide**. Le bouton **＋** dans l'application permet aussi de choisir l'un des deux si le lanceur Android prend en charge leur ajout.
5. Dans la configuration du widget, choisissez le **foyer** puis la **liste**, et confirmez **Afficher cette liste** ou **Créer le raccourci scan**. Le widget de liste regroupe les choix sous les en-têtes non sélectionnables **Courses** et **Checklists** ; le raccourci de scan propose uniquement des listes de courses. Si une connexion est nécessaire, utilisez **Connexion / serveur**, connectez-vous, puis touchez **Continuer** dans la barre Android pour retrouver la configuration.

Chaque widget conserve son propre choix de foyer et de liste. Vous pouvez en ajouter plusieurs et les redimensionner. Le bouton de réglages du widget permet de modifier ce choix.

## Widget Scan rapide

Le widget **myHome · Scan rapide** affiche un bouton de scan et le nom de la liste choisie, sans ses articles. Il propose trois colonnes sur une ligne par défaut sur les lanceurs récents et peut être redimensionné. Sa hauteur minimale de 48 dp permet de le réduire à une seule rangée, selon la grille du lanceur. Plusieurs raccourcis peuvent viser des foyers ou des listes différents.

Après la mise à jour, faites un appui long sur le widget puis réduisez sa hauteur. Si un widget déjà installé reste limité à deux rangées, retirez uniquement ce widget de l'écran d'accueil puis ajoutez-le à nouveau pour que le lanceur recharge ses nouvelles limites. Il faudra alors choisir à nouveau son foyer et sa liste.

Touchez sa grande zone **Scanner** pour ouvrir le scanner dans l'application, directement pour cette liste. Le scanner habituel propose la caméra, la douchette et la saisie manuelle. Un code connu ajoute le produit à la liste ; un code inconnu demande d'abord son association à un produit existant ou nouveau. Le petit bouton de réglages permet de changer de foyer ou de liste.

Le raccourci ne charge aucun article et ne déclenche pas d'actualisation réseau en arrière-plan. Une connexion au NAS reste nécessaire pour scanner et ajouter le produit. Si la session a expiré, l'application demande une connexion puis reprend la destination prévue ; une liste supprimée ou inaccessible est refusée sans choisir une autre liste à sa place. Le nom mémorisé est masqué hors de sa session de connexion.

## Apparence du widget

Dans **myHome Android → Paramètres → Apparence**, choisissez **Mode Clair**, **Mode Sombre** ou **Appliquer le mode de l’appareil**. Tous les widgets et leur écran de configuration reprennent ce choix. Le mode clair s'applique par défaut ; le mode de l'appareil suit le thème Android.

Le choix est repris automatiquement pendant que l'application Android est ouverte, puis conservé pour les widgets, y compris hors connexion. Après installation de la mise à jour, ouvrez une fois myHome pour reprendre le réglage déjà enregistré. Ce réglage est propre à cet appareil et à l'adresse du NAS : un choix fait dans Chrome ou sur un autre appareil n'est pas partagé avec l'application Android.

## Utilisation

- La liste défile verticalement. Le titre et l'icône correspondent à la liste choisie ; les quantités supérieures à 1 et les notes des courses sont affichées. L'ordre des checklists est conservé et les éléments cochés sont regroupés en bas.
- Les cases se cochent et se décochent directement dans le widget. Une modification simultanée sur un autre appareil demande une actualisation plutôt que d'écraser la modification.
- **Ajouter**, **Modifier**, **Supprimer**, **Scanner** et **Supprimer les terminés** ouvrent l'écran web correspondant dans l'application Android. La suppression reste soumise à confirmation. Le scanner est réservé aux courses et demande l'autorisation caméra ; la saisie manuelle d'un code et les douchettes clavier restent disponibles.
- Un libellé lié à une autre checklist permet d'ouvrir sa cible. Les détails et les autres actions de liste sont accessibles dans l'application.
- Le retour à l'écran d'accueil après une opération dans l'application demande une actualisation des widgets. Le bouton **↻** permet également de la demander immédiatement.

Le widget ne contient pas de véritable champ de texte ni d'aperçu caméra dans l'écran d'accueil : Android impose d'ouvrir une fenêtre de l'application pour ces actions.

Avec **l'APK 1.0.8 et le NAS à jour**, le bouton **Ouvrir la caméra** ouvre un écran de scan Android natif. La mise au point est déclenchée directement et renouvelée pendant la lecture, sans dépendre de l'autofocus de WebView. Le choix caméra arrière/avant reste celui du formulaire. Un code valide revient dans la liste choisie ; les codes inconnus suivent l'association habituelle à un produit. **Annuler** ou le bouton Retour referme le scanner sans ajouter d'article. Un refus de permission affiche un message et laisse la saisie manuelle disponible.

Le navigateur et les anciennes APK gardent le scanner web existant. La tentative de réglage continu ajoutée précédemment reste un complément pour ce chemin web dans l'application ; elle avait été insuffisante sur l'appareil signalé. La netteté réelle du nouveau scanner natif reste à vérifier sur le téléphone.

## Connexion et actualisation

Le NAS doit être joignable par le téléphone : réseau local, VPN ou adresse HTTPS extérieure selon votre installation. Utilisez la même adresse que celle configurée comme `SITE_ORIGIN` sur le NAS. Un certificat invalide n'est pas contourné par l'application.

Le widget réutilise la session de connexion de l'application Android. Il ne conserve pas votre mot de passe. Les données de liste mises en cache restent privées à l'application et sont liées à cette session. Après une déconnexion, un changement de compte ou d'adresse du NAS, une reconnexion ou une reconfiguration peut être nécessaire.

L'application demande une actualisation périodique toutes les **30 minutes** et après les interactions. Android peut retarder les traitements en arrière-plan pour économiser la batterie ; la date de dernière mise à jour et les erreurs sont affichées dans le widget. Hors connexion, les données déjà chargées peuvent rester visibles, mais les écritures ne sont pas mises en attente pour être rejouées ultérieurement.

## Mises à jour manuelles

Après cette première installation sous l'identifiant `fr.myhome.android`, installez les prochaines versions de `myhome-android.apk` **par-dessus myHome**, sans désinstaller l'application. Les réglages sont alors conservés. Les mises à jour de l'interface web se font sur le NAS ; les évolutions du widget ou du code Android nécessitent une nouvelle APK.

La version **1.0.2** reprend le thème violet de myHome dans la configuration du widget : carte de sélection, champs arrondis, bouton principal et états de chargement ou d'erreur. Les listes restent regroupées sous **Courses** et **Checklists**, avec des en-têtes non sélectionnables. Ces évolutions concernent uniquement Android : aucune mise à jour du NAS n'est nécessaire si vous utilisez déjà les widgets de la version 1.0.0.

La version **1.0.3** applique aussi le choix d'apparence de l'application aux widgets, à leurs lignes et à leur configuration. Aucune mise à jour du NAS n'est nécessaire pour cette version.

La version **1.0.4** ajoute le widget **Scan rapide**, à côté du widget de liste existant. Cette version réutilise le scanner déjà présent sur le NAS et ne nécessite pas de mise à jour du NAS si les widgets précédents fonctionnent déjà.

La version **1.0.5** permet de réduire le widget **Scan rapide** à une seule rangée : hauteur minimale abaissée de 80 à 48 dp, marges compactées et indications secondaires masquées lorsque la hauteur est réduite. Aucune mise à jour du NAS n'est nécessaire.

La version **1.0.6** ajoute cette demande de mise au point pour la caméra arrière dans l'application et sa réapplication au toucher. Elle s'applique aussi aux scans ouverts depuis les widgets. Le navigateur web et le serveur restent inchangés : installez uniquement l'APK, sans mise à jour du NAS.

La version **1.0.7** applique le nouveau nom dans l'application, les widgets, les préférences, les liens et les identifiants techniques. Elle nécessite le serveur renommé et une nouvelle configuration Android, comme expliqué en première installation.

La version **1.0.8** ajoute le scanner caméra natif avec autofocus piloté par Android. **Mettez d'abord le NAS à jour avec `myhome-synology.zip`, puis installez l'APK par-dessus myHome 1.0.7**, sans désinstallation. Les réglages et widgets restent conservés. Le bouton caméra du formulaire existant et les scans ouverts depuis les widgets utilisent alors ce nouvel écran. Cette mise à jour ne modifie pas le schéma SQLite.

La livraison propose aussi le fichier `myhome-android-1.0.8.apk`, identique à `myhome-android.apk`, pour identifier explicitement cette version lors du transfert sur l'appareil.

La somme de contrôle de l'APK est fournie dans `myhome-android.apk.sha256`.

## Recompiler depuis le projet

Les sources Android se trouvent dans `android/` dans le dépôt. Elles sont distinctes du package des sources destinées au NAS. Depuis PowerShell, à la racine du projet :

```powershell
.\android\scripts\Install-Tools.ps1
.\android\scripts\Build-Apk.ps1
```

Les outils et caches sont installés dans `.runtime/`, en dehors de Git. La compilation produit une APK **release signée**, vérifie sa signature et écrit le fichier de contrôle SHA-256. Aucun compte myHome ni serveur n'est nécessaire pour compiler.

Pour une version suivante, augmentez le numéro de version Android :

```powershell
.\android\scripts\Build-Apk.ps1 -VersionCode 10 -VersionName 1.0.9
```

**Sauvegardez de manière privée tout le dossier `.runtime/android-signing/`.** Il contient la clé de signature et sa configuration. Cette même clé est indispensable pour installer de futures mises à jour par-dessus cette version. Elle n'est incluse ni dans Git, ni dans le package Synology, ni dans l'APK.
