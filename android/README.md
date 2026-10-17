# myHome Android

Application compagnon et widgets d'écran d'accueil pour le serveur myHome sur NAS Synology. Java et composants Android standards, Android 8.0+ (API 26), cible API 35. L'interface complète reste servie en HTTPS par le NAS ; seuls les widgets et l'intégration du téléphone sont natifs.

L'installation, l'usage et les mises à jour sont décrits dans [INSTALLER-ANDROID.md](../INSTALLER-ANDROID.md).

L'identifiant Android est désormais `fr.myhome.android`. Cette application s'installe séparément de l'ancienne application : renseignez à nouveau l'adresse du NAS, connectez-vous puis ajoutez les widgets souhaités. Les données du foyer restent sur le NAS.

## Construire l'APK sous Windows

Depuis la racine du dépôt, dans PowerShell :

```powershell
.\android\scripts\Install-Tools.ps1
.\android\scripts\Build-Apk.ps1
```

Les versions des outils et les sommes SHA-256 de leurs distributions sont fixées dans le script d'installation. Les téléchargements, SDK et caches restent dans `.runtime/`. `Build-Apk.ps1` compile `assembleRelease` et `lintRelease`, vérifie la signature et produit `myhome-android.apk` et son fichier `.sha256` à la racine du dépôt. Pour changer de version, utilisez `-VersionCode` et `-VersionName`.

La clé release persistante est générée une seule fois sous `.runtime/android-signing/` et doit être sauvegardée de manière privée. Elle n'est pas versionnée. Une compilation release sans cette clé est refusée ; les outils ne remplacent pas une clé existante dont le mot de passe aurait été perdu.

## Organisation

- `MainActivity` : serveur HTTPS configurable, WebView limitée à cette origine, authentification, caméra à la demande, liens vers les listes et ajout des widgets.
- `NativeScanActivity` : écran caméra local, ZXing Embedded 4.3.0 et Core 3.5.3, caméra choisie par son orientation réelle. Le mode `AUTO` déclenche l'autofocus immédiatement puis toutes les deux secondes si l'objectif le permet. Caméra libérée à la pause, à l'annulation et avant le retour du résultat.
- `NativeScanBridge` et `assets/native-scanner.js` : contrat versionné restreint au scan via `WebChromeClient.onJsPrompt`. Le document principal HTTPS du NAS reçoit `window.myHomeNativeScanner`; chaque retour est lié à sa page, son WebView, son origine et sa session. Un rechargement, changement de serveur/compte ou fermeture annule le résultat. Les codes sont validés et sérialisés en JSON ; aucune écriture métier n'est exécutée par le natif. Le NAS doit aussi être mis à jour pour utiliser ce contrat.
- `CameraFocusSupport` et `assets/camera-focus.js` : demande facultative de mise au point continue sur les pistes arrière déjà autorisées, puis réapplication au toucher de la vidéo. Le script reste limité au document principal de l'origine HTTPS du NAS, conserve les autres contraintes et ne bloque jamais le retour du flux. Aucun autofocus matériel n'est garanti si WebView n'expose pas cette capacité.
- `WidgetConfigureActivity` : foyer et liste propres à chaque instance, avec le thème choisi dans l'application.
- `AppAppearance` : préférence clair/sombre/appareil liée à l'origine du NAS, lue depuis le réglage web existant sans interface JavaScript native ; contextes et ressources de rendu adaptés.
- `MyHomeWidgetProvider` et `WidgetItemsService` : rendu, liste défilante, ordre, coches et rafraîchissement par jobs Android.
- `QuickScanWidgetProvider` : raccourci compact vers le scanner d'une liste de courses configurée, sans collection d'articles ni tâche réseau en arrière-plan.
- `WidgetActionActivity` : destination directe des clics sur les éléments, compatible avec les restrictions de lancement d'activités récentes.
- `ServerClient` : API existante, session HttpOnly partagée, origine exacte, refus des redirections et sessions modifiées.
- `WidgetStore` : configuration privée et cache de la seule liste, lié à l'empreinte de la session attendue ; aucune conservation de mot de passe.

Les actions de saisie, caméra et confirmation s'ouvrent dans l'application ; les widgets Android ne peuvent pas embarquer les formulaires web. L'accès au scanner natif reste limité à l'origine HTTPS du NAS configuré et ne transmet qu'un résultat de lecture. Aucune interface Java générale n'est exposée au JavaScript, aucun certificat HTTPS n'est contourné et aucune écriture n'est rejouée automatiquement.

Les tests natifs de la tâche Gradle `:app:testDebugUnitTest` utilisent Robolectric sur API 28 et 35, avec les ressources et les préférences Android réelles. Les dépendances AndroidX de ce banc de tests restent limitées à `testImplementation` et ne sont pas embarquées dans l'APK.

Les scripts embarqués se vérifient avec Node.js 22 ou ultérieur, depuis la racine du dépôt : `node --test android/tests/camera-focus.test.mjs android/tests/native-scanner.test.mjs`. Les tests Robolectric couvrent aussi le choix de caméra, le mode autofocus, les permissions, les résultats uniques et les réponses annulées après navigation ou changement de session. Ces tests simulent le matériel ; ils ne vérifient pas la netteté sur un objectif physique.

Références : [widgets Android](https://developer.android.com/develop/ui/views/appwidgets), [collections](https://developer.android.com/develop/ui/views/appwidgets/collections), [WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), [thème sombre dans WebView](https://developer.android.com/develop/ui/views/layout/webapps/dark-theme).

## Crédits du scanner natif

Le scanner utilise [ZXing Android Embedded 4.3.0](https://github.com/journeyapps/zxing-android-embedded/tree/v4.3.0), des auteurs ZXing et de Journey Mobile, et [ZXing Core 3.5.3](https://github.com/zxing/zxing/tree/zxing-3.5.3), sous licence Apache 2.0. Les licences et notices officielles sont conservées dans [`app/src/main/assets/licenses/`](app/src/main/assets/licenses/) et embarquées dans l’APK.
