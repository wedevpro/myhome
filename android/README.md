# MyHomeIA Android

Application compagnon et widgets d'écran d'accueil pour le serveur MyHomeIA sur NAS Synology. Java et composants Android standards, Android 8.0+ (API 26), cible API 35. L'interface complète reste servie en HTTPS par le NAS ; seuls les widgets et l'intégration du téléphone sont natifs.

L'installation, l'usage et les mises à jour sont décrits dans [INSTALLER-ANDROID.md](../INSTALLER-ANDROID.md).

## Construire l'APK sous Windows

Depuis la racine du dépôt, dans PowerShell :

```powershell
.\android\scripts\Install-Tools.ps1
.\android\scripts\Build-Apk.ps1
```

Les versions des outils et les sommes SHA-256 de leurs distributions sont fixées dans le script d'installation. Les téléchargements, SDK et caches restent dans `.runtime/`. `Build-Apk.ps1` compile `assembleRelease` et `lintRelease`, vérifie la signature et produit `myhomeia-android.apk` et son fichier `.sha256` à la racine du dépôt. Pour changer de version, utilisez `-VersionCode` et `-VersionName`.

La clé release persistante est générée une seule fois sous `.runtime/android-signing/` et doit être sauvegardée de manière privée. Elle n'est pas versionnée. Une compilation release sans cette clé est refusée ; les outils ne remplacent pas une clé existante dont le mot de passe aurait été perdu.

## Organisation

- `MainActivity` : serveur HTTPS configurable, WebView limitée à cette origine, authentification, caméra à la demande, liens vers les listes et ajout des widgets.
- `WidgetConfigureActivity` : foyer et liste propres à chaque instance, avec le thème choisi dans l'application.
- `AppAppearance` : préférence clair/sombre/appareil liée à l'origine du NAS, lue depuis le réglage web existant sans interface JavaScript native ; contextes et ressources de rendu adaptés.
- `MyHomeWidgetProvider` et `WidgetItemsService` : rendu, liste défilante, ordre, coches et rafraîchissement par jobs Android.
- `QuickScanWidgetProvider` : raccourci compact vers le scanner d'une liste de courses configurée, sans collection d'articles ni tâche réseau en arrière-plan.
- `WidgetActionActivity` : destination directe des clics sur les éléments, compatible avec les restrictions de lancement d'activités récentes.
- `ServerClient` : API existante, session HttpOnly partagée, origine exacte, refus des redirections et sessions modifiées.
- `WidgetStore` : configuration privée et cache de la seule liste, lié à l'empreinte de la session attendue ; aucune conservation de mot de passe.

Les actions de saisie, caméra et confirmation s'ouvrent dans l'application ; les widgets Android ne peuvent pas embarquer les formulaires web. Les permissions caméra restent demandées uniquement pour l'origine du NAS. Aucun pont JavaScript privilégié, contournement de certificat HTTPS ni écriture automatiquement rejouée n'est utilisé.

Les tests natifs de la tâche Gradle `:app:testDebugUnitTest` utilisent Robolectric sur API 28 et 35, avec les ressources et les préférences Android réelles. Les dépendances AndroidX de ce banc de tests restent limitées à `testImplementation` et ne sont pas embarquées dans l'APK.

Références : [widgets Android](https://developer.android.com/develop/ui/views/appwidgets), [collections](https://developer.android.com/develop/ui/views/appwidgets/collections), [WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), [thème sombre dans WebView](https://developer.android.com/develop/ui/views/layout/webapps/dark-theme).
