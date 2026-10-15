[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toolsRoot = Join-Path $projectRoot '.runtime\android-tools'
$sdkRoot = Join-Path $projectRoot '.runtime\android-sdk'
New-Item -ItemType Directory -Force -Path $toolsRoot, $sdkRoot | Out-Null

function Get-VerifiedArchive {
    param([string]$Name, [string]$Uri, [string]$Sha256)
    $archivePath = Join-Path $toolsRoot $Name
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Write-Host ('Downloading ' + $Name)
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $archivePath
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $Sha256) {
        throw ('Checksum mismatch: ' + $archivePath + '. Remove this archive and retry.')
    }
    return $archivePath
}

$jdkHome = Join-Path $toolsRoot 'jdk-21.0.12.1+1'
if (-not (Test-Path -LiteralPath (Join-Path $jdkHome 'bin\javac.exe'))) {
    $jdkZip = Get-VerifiedArchive 'temurin21-windows-x64.zip' 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip' 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'
    Expand-Archive -LiteralPath $jdkZip -DestinationPath $toolsRoot -Force
}

$gradleHome = Join-Path $toolsRoot 'gradle-8.11.1'
if (-not (Test-Path -LiteralPath (Join-Path $gradleHome 'bin\gradle.bat'))) {
    $gradleZip = Get-VerifiedArchive 'gradle-8.11.1-bin.zip' 'https://services.gradle.org/distributions/gradle-8.11.1-bin.zip' 'f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6'
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $toolsRoot -Force
}

$sdkManager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $sdkManager)) {
    $sdkZip = Get-VerifiedArchive 'commandlinetools-win-15859902_latest.zip' 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    $unpackRoot = Join-Path $toolsRoot 'sdk-commandline-unpack'
    Expand-Archive -LiteralPath $sdkZip -DestinationPath $unpackRoot -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'cmdline-tools') | Out-Null
    $moveSource = (Resolve-Path -LiteralPath (Join-Path $unpackRoot 'cmdline-tools')).ProviderPath
    $moveTarget = [System.IO.Path]::GetFullPath((Join-Path $sdkRoot 'cmdline-tools\latest'))
    $runtimePrefix = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $moveSource.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not $moveTarget.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SDK move outside project runtime directory.' }
    Move-Item -LiteralPath $moveSource -Destination $moveTarget
}

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.runtime\gradle-home'
# Keep Android tools' preferences inside the project as well.
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.runtime\android-user'
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-35\android.jar')) -or -not (Test-Path -LiteralPath (Join-Path $sdkRoot 'build-tools\35.0.0\apksigner.bat'))) {
    1..100 | ForEach-Object { 'y' } | & $sdkManager --sdk_root=$sdkRoot --licenses
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK license acceptance failed.' }
    & $sdkManager --sdk_root=$sdkRoot 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed.' }
}

Write-Host ('Java: ' + $jdkHome)
Write-Host ('Gradle: ' + $gradleHome)
Write-Host ('Android SDK: ' + $sdkRoot)
