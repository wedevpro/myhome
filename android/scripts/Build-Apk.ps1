[CmdletBinding()]
param(
    [string]$JavaHome,
    [string]$AndroidSdk,
    [int]$VersionCode = 2,
    [string]$VersionName = '1.0.1',
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$androidRoot = Join-Path $projectRoot 'android'
if (-not $JavaHome) { $JavaHome = Join-Path $projectRoot '.runtime\android-tools\jdk-21.0.12.1+1' }
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $projectRoot '.runtime\android-sdk' }
if (-not $OutputDirectory) { $OutputDirectory = $projectRoot }
if ($VersionCode -lt 1 -or $VersionName -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][A-Za-z0-9]+)*$') { throw 'Invalid Android version.' }
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\keytool.exe'))) { throw 'Java JDK missing. Run Install-Tools.ps1 first or pass -JavaHome.' }
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms\android-35\android.jar'))) { throw 'Android SDK 35 missing. Run Install-Tools.ps1 first or pass -AndroidSdk.' }

$env:JAVA_HOME = (Resolve-Path -LiteralPath $JavaHome).ProviderPath
$env:ANDROID_HOME = (Resolve-Path -LiteralPath $AndroidSdk).ProviderPath
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.runtime\gradle-home'
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.runtime\android-user'
$signingRoot = Join-Path $projectRoot '.runtime\android-signing'
$signingFile = Join-Path $signingRoot 'signing.properties'
$keystorePath = Join-Path $signingRoot 'myhomeia-release.jks'
New-Item -ItemType Directory -Force -Path $signingRoot, $OutputDirectory | Out-Null

if (-not (Test-Path -LiteralPath $signingFile)) {
    if (Test-Path -LiteralPath $keystorePath) { throw 'The persistent release key already exists, but signing.properties is missing. Restore its password backup before building.' }
    $randomBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
    $password = [System.BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $env:MYHOMEIA_SIGNING_PASSWORD = $password
    try {
        & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $keystorePath -storetype JKS -storepass:env MYHOMEIA_SIGNING_PASSWORD -keypass:env MYHOMEIA_SIGNING_PASSWORD -alias myhomeia-release -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=MyHomeIA, O=MyHomeIA' -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }
        [System.IO.File]::WriteAllText($signingFile, "storeFile=myhomeia-release.jks`nstorePassword=$password`nkeyAlias=myhomeia-release`nkeyPassword=$password`n", [System.Text.Encoding]::ASCII)
    } finally {
        Remove-Item Env:\MYHOMEIA_SIGNING_PASSWORD -ErrorAction SilentlyContinue
        $password = $null
    }
    Write-Host 'Persistent release key created in .runtime/android-signing. Keep a private backup of this directory for future updates.'
}
if (-not (Test-Path -LiteralPath $keystorePath)) { throw 'Persistent release key missing. Restore .runtime/android-signing before building.' }

Push-Location $androidRoot
try {
    $gradleLauncher = Join-Path $projectRoot '.runtime\android-tools\gradle-8.11.1\bin\gradle.bat'
    if (-not (Test-Path -LiteralPath $gradleLauncher)) { $gradleLauncher = Join-Path $androidRoot 'gradlew.bat' }
    & $gradleLauncher --no-daemon --console=plain ("-PmyhomeiaVersionCode=$VersionCode") ("-PmyhomeiaVersionName=$VersionName") ':app:assembleRelease' ':app:lintRelease'
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
} finally { Pop-Location }

$apkPath = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
& (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat') verify --verbose --print-certs $apkPath
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$deliveryPath = Join-Path $OutputDirectory 'myhomeia-android.apk'
Copy-Item -LiteralPath $apkPath -Destination $deliveryPath -Force
$hash = (Get-FileHash -LiteralPath $deliveryPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(($deliveryPath + '.sha256'), ($hash + '  myhomeia-android.apk' + "`n"), [System.Text.Encoding]::ASCII)
Write-Host ('Signed APK: ' + $deliveryPath)
