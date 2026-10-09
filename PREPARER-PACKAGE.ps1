$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$archivePath = Join-Path $packageRoot 'myhomeia-synology.zip'
$sourceFiles = [System.Collections.Generic.List[string]]::new()
$rootFiles = @('Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', 'GUIDE-SYNOLOGY.md', 'ETAT-LIVRAISON.md', 'PREPARER-PACKAGE.ps1')
$appFiles = @('package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs', 'components.json', 'README.md', '.env.example', '.gitignore')
$appFolders = @('app', 'components', 'db', 'drizzle', 'hooks', 'lib', 'public', 'tests', 'vendor', 'docs')
$appScripts = @('build-nas.mjs', 'nas-entrypoint.mjs', 'reminder-worker.ts')

foreach ($name in $rootFiles) { $sourceFiles.Add((Join-Path $packageRoot $name)) }
foreach ($name in $appFiles) { $sourceFiles.Add((Join-Path $packageRoot ('app/' + $name))) }
foreach ($name in $appScripts) { $sourceFiles.Add((Join-Path $packageRoot ('app/scripts/' + $name))) }
foreach ($name in $appFolders) {
    $folderPath = Join-Path $packageRoot ('app/' + $name)
    foreach ($file in Get-ChildItem -LiteralPath $folderPath -Recurse -File -Force) {
        if ($file.Name -like 'connector*') { continue }
        if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Symbolic link cannot be packaged: ' + $file.FullName) }
        $sourceFiles.Add($file.FullName)
    }
}

# Use an explicit source allowlist: no development DB, Windows dependencies,
# secret .env, old Sites archive or generated production build enters the ZIP.
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($filePath in $sourceFiles) {
        $absolutePath = [System.IO.Path]::GetFullPath($filePath)
        if (-not $absolutePath.StartsWith($packageRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected source path outside project' }
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) { throw ('Missing package file: ' + $absolutePath) }
        $entryName = $absolutePath.Substring($packageRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $absolutePath, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$packageHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($archivePath + '.sha256') -Value ($packageHash + '  myhomeia-synology.zip') -Encoding Ascii
Write-Output ('Package: ' + $archivePath)
Write-Output ('Files: ' + $sourceFiles.Count)
Write-Output ('SHA256: ' + $packageHash)
