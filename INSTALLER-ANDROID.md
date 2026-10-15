# Installer MyHomeIA et ses widgets sur Android

L'application **MyHomeIA Android** utilise le même serveur, les mêmes comptes et les mêmes foyers que l'application web sur le NAS. Elle nécessite **Android 8.0 ou ultérieur** et une adresse **HTTPS avec un certificat valide**. Elle ne contient ni adresse de NAS, ni compte préconfiguré.

## Première installation

1. Mettez d'abord le NAS à jour avec le nouveau `myhomeia-synology.zip`, selon [GUIDE-SYNOLOGY.md](GUIDE-SYNOLOGY.md). Les sources web de cette livraison permettent d'ouvrir la liste et le formulaire demandés par le widget.
2. Copiez `myhomeia-android.apk` sur le téléphone ou la tablette. Ouvrez ce fichier et autorisez l'installation depuis cette source si Android le demande.
3. Ouvrez **MyHomeIA**, renseignez l'adresse HTTPS exacte utilisée pour accéder au NAS, puis connectez-vous avec votre compte habituel.
4. Depuis l'écran d'accueil Android, faites un appui long, choisissez **Widgets**, puis **MyHomeIA**. Le bouton **＋** dans l'application peut également proposer l'ajout d'un widget si le lanceur Android le prend en charge.
5. Dans la configuration du widget, choisissez le **foyer** puis la **liste de courses ou checklist**, et confirmez **Afficher cette liste**. Si une connexion est nécessaire, utilisez **Ouvrir MyHomeIA**, connectez-vous, puis touchez **Continuer** dans la barre Android pour retrouver la configuration.

Chaque widget conserve son propre choix de foyer et de liste. Vous pouvez en ajouter plusieurs et les redimensionner. Le bouton de réglages du widget permet de modifier ce choix.

## Utilisation

- La liste défile verticalement. Le titre et l'icône correspondent à la liste choisie ; les quantités supérieures à 1 et les notes des courses sont affichées. L'ordre des checklists est conservé et les éléments cochés sont regroupés en bas.
- Les cases se cochent et se décochent directement dans le widget. Une modification simultanée sur un autre appareil demande une actualisation plutôt que d'écraser la modification.
- **Ajouter**, **Modifier**, **Supprimer**, **Scanner** et **Supprimer les terminés** ouvrent l'écran web correspondant dans l'application Android. La suppression reste soumise à confirmation. Le scanner est réservé aux courses et demande l'autorisation caméra ; la saisie manuelle d'un code et les douchettes clavier restent disponibles.
- Un libellé lié à une autre checklist permet d'ouvrir sa cible. Les détails et les autres actions de liste sont accessibles dans l'application.
- Le retour à l'écran d'accueil après une opération dans l'application demande une actualisation des widgets. Le bouton **↻** permet également de la demander immédiatement.

Le widget ne contient pas de véritable champ de texte ni d'aperçu caméra dans l'écran d'accueil : Android impose d'ouvrir une fenêtre de l'application pour ces actions.

## Connexion et actualisation

Le NAS doit être joignable par le téléphone : réseau local, VPN ou adresse HTTPS extérieure selon votre installation. Utilisez la même adresse que celle configurée comme `SITE_ORIGIN` sur le NAS. Un certificat invalide n'est pas contourné par l'application.

Le widget réutilise la session de connexion de l'application Android. Il ne conserve pas votre mot de passe. Les données de liste mises en cache restent privées à l'application et sont liées à cette session. Après une déconnexion, un changement de compte ou d'adresse du NAS, une reconnexion ou une reconfiguration peut être nécessaire.

L'application demande une actualisation périodique toutes les **30 minutes** et après les interactions. Android peut retarder les traitements en arrière-plan pour économiser la batterie ; la date de dernière mise à jour et les erreurs sont affichées dans le widget. Hors connexion, les données déjà chargées peuvent rester visibles, mais les écritures ne sont pas mises en attente pour être rejouées ultérieurement.

## Mises à jour manuelles

Installez les prochaines versions de `myhomeia-android.apk` **par-dessus la version existante**, sans désinstaller l'application. Les réglages sont alors conservés. Les mises à jour de l'interface web se font sur le NAS ; les évolutions du widget ou du code Android nécessitent une nouvelle APK.

La somme de contrôle de l'APK est fournie dans `myhomeia-android.apk.sha256`.

## Recompiler depuis le projet

Les sources Android se trouvent dans `android/` dans le dépôt. Elles sont distinctes du package des sources destinées au NAS. Depuis PowerShell, à la racine du projet :

```powershell
.\android\scripts\Install-Tools.ps1
.\android\scripts\Build-Apk.ps1
```

Les outils et caches sont installés dans `.runtime/`, en dehors de Git. La compilation produit une APK **release signée**, vérifie sa signature et écrit le fichier de contrôle SHA-256. Aucun compte MyHomeIA ni serveur n'est nécessaire pour compiler.

Pour une version suivante, augmentez le numéro de version Android :

```powershell
.\android\scripts\Build-Apk.ps1 -VersionCode 2 -VersionName 1.0.1
```

**Sauvegardez de manière privée tout le dossier `.runtime/android-signing/`.** Il contient la clé de signature et sa configuration. Cette même clé est indispensable pour installer de futures mises à jour par-dessus cette version. Elle n'est incluse ni dans Git, ni dans le package Synology, ni dans l'APK.
