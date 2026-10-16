[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($PSScriptRoot)
$parent = Split-Path -Parent $source
$destination = [System.IO.Path]::GetFullPath((Join-Path $parent 'myHome'))

if ($source -ceq $destination) {
    Write-Host 'Le dossier du projet porte deja le nom myHome.'
    return
}
foreach ($marker in @('app/package.json', 'android/settings.gradle', 'PREPARER-PACKAGE.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $marker) -PathType Leaf)) {
        throw ('Le dossier source ne correspond pas au projet attendu : ' + $source)
    }
}
if (Test-Path -LiteralPath $destination) {
    throw ('La destination existe deja. Aucun ecrasement ni fusion : ' + $destination)
}
if ((Split-Path -Parent $destination) -ne $parent) {
    throw 'La destination doit rester dans le meme dossier parent.'
}

# Liberer aussi le repertoire courant de cette console avant le deplacement.
# Fermez au prealable l IDE, les serveurs et les consoles ouverts sur le projet.
Set-Location -LiteralPath $parent
try {
    Move-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
} catch {
    throw ('Renommage impossible. Fermez les programmes utilisant le projet, puis relancez ce script. Detail : ' + $_.Exception.Message)
}
Write-Host ('Dossier renomme : ' + $destination)
Write-Host 'Rouvrez ce dossier dans votre IDE.'
