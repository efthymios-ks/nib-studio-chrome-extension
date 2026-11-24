#Requires -Version 5.1

<#
.SYNOPSIS
    Tests, builds and packages the extension for manual upload to the Chrome Web Store.

.DESCRIPTION
    Runs Invoke-Test.ps1 first, which also makes sure Node.js and the npm packages
    are there, and stops on a red suite, so a failing test can never produce a
    package. Writes the new version into public/manifest.json (the source of truth),
    builds dist, copies the result into artifacts/NibStudio-<version>/ without source
    maps, and zips the same content into artifacts/NibStudio-<version>.zip.

    The zip check fails if manifest.json, THIRD_PARTY_NOTICES.txt or an entry point
    is missing, if the manifest holds another version, or if a source map is in the
    package.

    Called without -Version, the script prints the current version from
    public/manifest.json and prompts for the new one, suggesting the next patch.

    A version that already has a package in the output folder, as the
    NibStudio-<version> folder, its .zip or its -sources-vendored.zip, stops the
    script before the tests run and before anything is written, unless -Force is
    given.

    With -IncludeVendor, also runs Package-Vendor.ps1 to pack every dependency into
    vendor/tarballs/ and writes artifacts/NibStudio-<version>-sources-vendored.zip,
    which rebuilds offline after Package-Vendor.ps1 -Rewrite.

    Upload the zip by hand in the Chrome Web Store developer dashboard. The store
    only takes dot-separated numbers and each upload needs a higher version than
    the previous one.

    Exit codes:
      0  packaged
      1  a step failed

.PARAMETER Version
    Version to stamp, as 1.2.3. If omitted, the script prompts.

.PARAMETER OutputPath
    Where the folder and zip go. Default .\artifacts.

.PARAMETER SkipTests
    Package without the suite.

.PARAMETER Force
    Replace an existing package for the version. The NibStudio-<version> folder,
    NibStudio-<version>.zip and NibStudio-<version>-sources-vendored.zip are
    deleted once the tests and the build pass, then the package is written again;
    a sources zip is written again only with -IncludeVendor.

.PARAMETER IncludeVendor
    Also produce a sources zip with every dependency tarball, for offline rebuilds.

.EXAMPLE
    ./Publish-Extension.ps1

.EXAMPLE
    ./Publish-Extension.ps1 -Version 1.0.1 -Force

.EXAMPLE
    ./Publish-Extension.ps1 -Version 1.0.1 -IncludeVendor
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Version,

    [string]$OutputPath,

    [switch]$SkipTests,

    [switch]$Force,

    [switch]$IncludeVendor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# powershell.exe -File leaves $PSScriptRoot empty in the param defaults of an advanced script.
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'artifacts' }

$script:PackageName = 'NibStudio'
$script:DistPath = Join-Path $PSScriptRoot 'dist'
$script:SourceManifestPath = Join-Path $PSScriptRoot 'public/manifest.json'
$script:VersionPattern = '^\d+\.\d+\.\d+$'
# The value of the manifest's "version" property, without its quotes.
$script:ManifestVersionValuePattern = '(?<="version"\s*:\s*")[^"]*'
$script:ExcludedExtensions = @('.map')
# Left out of the sources zip when git can't list the files; vendor/tarballs is added back on purpose.
$script:SourceExcludedFolders = @('dist', 'artifacts', '.debug-profile', '.git', '.playwright-mcp', 'vendor/tarballs')
$script:SourceExcludedFolderNames = @('node_modules', '.git')
$script:SourceExcludedPatterns = @('*.log', '*.zip', 'testResults.xml')
$script:RequiredEntries = @(
    'manifest.json'
    'THIRD_PARTY_NOTICES.txt'
    'background.js'
    'nib-studio/index.html'
    'nib-studio/main.js'
    'nib-studio/styles.css'
    'nib-studio/imageDecodeWorker.js'
    'nib-studio/lookupWorker.js'
    'nib-studio/pdfjs/LICENSE'
    'nib-studio/pdfjs/pdf.worker.min.mjs'
    'nib-studio/pdfjs/wasm/jbig2_nowasm_fallback.js'
    'nib-studio/pdfjs/wasm/openjpeg_nowasm_fallback.js'
)

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ''
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Write-Good {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "   [ok]   $Message" -ForegroundColor Green
}

function Write-Note {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "          $Message" -ForegroundColor DarkGray
}

function Write-Warn {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "   [warn] $Message" -ForegroundColor Yellow
}

function Exit-WithError {
    param(
        [Parameter(Mandatory)][string]$Message,
        [string[]]$Detail = @()
    )
    Write-Host "   [fail] $Message" -ForegroundColor Red
    foreach ($line in $Detail) { Write-Note $line }
    exit 1
}

# The folder and zips a package for the version leaves in the output folder, those that exist.
function Get-ExistingPackagePath {
    param(
        [Parameter(Mandatory)][string]$Folder,
        [Parameter(Mandatory)][string]$PackageVersion
    )

    $baseName = "$script:PackageName-$PackageVersion"
    foreach ($name in @($baseName, "$baseName.zip", "$baseName-sources-vendored.zip")) {
        $path = Join-Path $Folder $name
        if (Test-Path -LiteralPath $path) { $path }
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][scriptblock]$Command
    )

    & $Command | Out-Host
    if ($LASTEXITCODE -ne 0) { Exit-WithError "$Description failed (exit $LASTEXITCODE)" }
}

function Get-ManifestVersion {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

# Replaces only the version value, so the rest of the file keeps its formatting; a ConvertTo-Json
# round trip on Windows PowerShell 5.1 re-indents the file and escapes characters such as < and >.
function Set-ManifestVersion {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$NewVersion
    )

    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $versionValue = [regex]$script:ManifestVersionValuePattern
    if (-not $versionValue.IsMatch($text)) { Exit-WithError "no version property in $Path" }
    $updated = $versionValue.Replace($text, $NewVersion, 1)
    [System.IO.File]::WriteAllText($Path, $updated, (New-Object System.Text.UTF8Encoding $false))
}

function Get-SuggestedNextVersion {
    param([Parameter(Mandatory)][string]$CurrentVersion)

    if ($CurrentVersion -notmatch $script:VersionPattern) { return '' }
    $parts = $CurrentVersion -split '\.'
    return "{0}.{1}.{2}" -f $parts[0], $parts[1], ([int]$parts[2] + 1)
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$Path
    )

    $base = (Convert-Path -LiteralPath $BasePath).TrimEnd('\', '/')
    $full = $Path.TrimEnd('\', '/')
    if ($full -eq $base) { return '.' }
    if (-not $full.StartsWith("$base\", [System.StringComparison]::OrdinalIgnoreCase)) { return $full }
    return $full.Substring($base.Length + 1)
}

function Copy-ExtensionFolder {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$DestinationPath
    )

    $null = New-Item -ItemType Directory -Path $DestinationPath -Force
    $files = Get-ChildItem -LiteralPath $SourcePath -Recurse -File |
        Where-Object { $script:ExcludedExtensions -notcontains $_.Extension }

    foreach ($file in $files) {
        $relative = Get-RelativePath -BasePath $SourcePath -Path $file.FullName
        $target = Join-Path $DestinationPath $relative
        $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }

    return @($files).Count
}

function New-ExtensionZip {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$ZipPath
    )

    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $SourcePath -Recurse -File) {
            $entryName = (Get-RelativePath -BasePath $SourcePath -Path $file.FullName) -replace '\\', '/'
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Test-ExtensionZip {
    param(
        [Parameter(Mandatory)][string]$ZipPath,
        [Parameter(Mandatory)][string]$ExpectedVersion
    )

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entryNames = @($zip.Entries | ForEach-Object FullName)
        $manifestEntry = $zip.GetEntry('manifest.json')
        if (-not $manifestEntry) { Exit-WithError 'manifest.json is not at the zip root' }

        $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json }
        finally { $reader.Dispose() }

        $missing = @($script:RequiredEntries | Where-Object { $entryNames -notcontains $_ })
        if ($missing.Count -gt 0) { Exit-WithError "missing from the zip: $($missing -join ', ')" }
        if ($manifest.version -ne $ExpectedVersion) { Exit-WithError "manifest says $($manifest.version), expected $ExpectedVersion" }
        if (@($entryNames | Where-Object { $_ -like '*.map' }).Count -gt 0) { Exit-WithError 'source maps leaked into the zip' }

        if (-not $manifest.PSObject.Properties['icons']) {
            Write-Warn 'manifest has no icons; Chrome Web Store needs a 128px icon before upload'
        }
    }
    finally {
        $zip.Dispose()
    }
}

# Relative paths, with forward slashes, of the files git would commit; $null when git can't tell.
function Get-GitSourceFile {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $null }

    try {
        $output = & git -C $PSScriptRoot ls-files --cached --others --exclude-standard 2>$null
    }
    catch {
        return $null
    }
    if ($LASTEXITCODE -ne 0) { return $null }

    return @($output | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot $_) -PathType Leaf) })
}

function Test-SourceExcluded {
    param([Parameter(Mandatory)][string]$RelativePath)

    foreach ($folder in $script:SourceExcludedFolders) {
        if ($RelativePath.StartsWith("$folder/", [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    $segments = $RelativePath.Split('/')
    foreach ($segment in @($segments | Select-Object -SkipLast 1)) {
        if ($segment -in $script:SourceExcludedFolderNames) { return $true }
    }
    $name = $segments[-1]
    return @($script:SourceExcludedPatterns | Where-Object { $name -like $_ }).Count -gt 0
}

# Walks the tree without entering excluded folders such as node_modules; mirrors .gitignore.
function Get-FallbackSourceFile {
    param([string]$Folder = $PSScriptRoot)

    $root = $PSScriptRoot.TrimEnd('\', '/')
    foreach ($item in Get-ChildItem -LiteralPath $Folder -Force) {
        $relative = $item.FullName.Substring($root.Length + 1).Replace('\', '/')
        if ($item.PSIsContainer) {
            if (Test-SourceExcluded -RelativePath "$relative/") { continue }
            Get-FallbackSourceFile -Folder $item.FullName
            continue
        }
        if (-not (Test-SourceExcluded -RelativePath $relative)) { $relative }
    }
}

function Get-SourceFile {
    $files = Get-GitSourceFile
    if ($null -eq $files) {
        Write-Note 'git cannot list the files here (not installed or not a git repo); leaving out the ignored folders by path'
        $files = @(Get-FallbackSourceFile)
    }

    return @($files | Sort-Object -Unique)
}

# Windows PowerShell 5.1 does not load the zip types on its own.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $script:SourceManifestPath)) {
    Exit-WithError "source manifest not found at $script:SourceManifestPath"
}
$currentVersion = Get-ManifestVersion -Path $script:SourceManifestPath

Write-Host ''
Write-Host "$script:PackageName" -ForegroundColor White
Write-Note "current version: $currentVersion"

if (-not $Version) {
    $suggested = Get-SuggestedNextVersion -CurrentVersion $currentVersion
    $prompt = if ($suggested) { "New version [press Enter for $suggested]" } else { "New version (as 1.2.3)" }
    $entered = Read-Host $prompt
    $Version = if ([string]::IsNullOrWhiteSpace($entered)) { $suggested } else { $entered.Trim() }
}

if ($Version -notmatch $script:VersionPattern) {
    Exit-WithError "version '$Version' is not valid; use 1.2.3"
}
if ($Version -eq $currentVersion) {
    Exit-WithError "version '$Version' matches the current one; the store needs a higher number than the last upload"
}
Write-Host "   new version: $Version" -ForegroundColor White

$existingPackages = @(Get-ExistingPackagePath -Folder $OutputPath -PackageVersion $Version)
if ($existingPackages.Count -gt 0) {
    if (-not $Force) {
        Exit-WithError "a $Version package already exists; pass -Force to replace it, or pick another version" -Detail $existingPackages
    }
    Write-Warn "-Force: the existing $Version package is replaced once the tests and the build pass"
}

Write-Step 'tests'

$testRunner = Join-Path $PSScriptRoot 'Invoke-Test.ps1'
if ($SkipTests) {
    & $testRunner -InstallOnly | Out-Host
    if ($LASTEXITCODE -ne 0) { Exit-WithError "Node.js or the npm packages are not ready (exit $LASTEXITCODE)" }
    Write-Note 'skipped (-SkipTests), packaging only'
}
else {
    & $testRunner -Output None | Out-Host
    if ($LASTEXITCODE -ne 0) { Exit-WithError "tests failed (exit $LASTEXITCODE), nothing was packaged" }
    Write-Good 'suite green'
}

Write-Step 'build'

Set-ManifestVersion -Path $script:SourceManifestPath -NewVersion $Version
Write-Good "public/manifest.json stamped $Version"

$folderPath = Join-Path $OutputPath "$script:PackageName-$Version"
$zipPath = Join-Path $OutputPath "$script:PackageName-$Version.zip"

Push-Location -LiteralPath $PSScriptRoot
try {
    Invoke-Native 'build' { node scripts/build.mjs }
}
finally {
    Pop-Location
}
Write-Good 'dist built'

Write-Step "package -> $folderPath (+ .zip)"

# Reached with something to replace only under -Force; the check before the tests stops otherwise.
foreach ($target in @(Get-ExistingPackagePath -Folder $OutputPath -PackageVersion $Version)) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Note "removed $target"
}
$null = New-Item -ItemType Directory -Path $OutputPath -Force

$fileCount = Copy-ExtensionFolder -SourcePath $script:DistPath -DestinationPath $folderPath
Write-Good "folder: $fileCount files"

New-ExtensionZip -SourcePath $folderPath -ZipPath $zipPath
Write-Good "zip: $((Get-Item -LiteralPath $zipPath).Length) bytes"

Test-ExtensionZip -ZipPath $zipPath -ExpectedVersion $Version
Write-Good 'manifest, notices and entry points present; no source maps'

if ($IncludeVendor) {
    Write-Step 'pack vendor tarballs'
    & (Join-Path $PSScriptRoot 'Package-Vendor.ps1') | Out-Host
    if ($LASTEXITCODE -ne 0) { Exit-WithError "Package-Vendor failed (exit $LASTEXITCODE)" }

    $sourcesZipPath = Join-Path $OutputPath "$script:PackageName-$Version-sources-vendored.zip"

    Write-Step "package sources + vendor -> $sourcesZipPath"
    $topFolder = "$script:PackageName-$Version-sources"
    $trackedFiles = @(Get-SourceFile)
    if ($trackedFiles.Count -eq 0) { Exit-WithError 'found no source files to package' }
    $tarballFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'vendor/tarballs') -Filter '*.tgz' -File |
        ForEach-Object { 'vendor/tarballs/' + $_.Name })
    $allRelative = @($trackedFiles + $tarballFiles | Sort-Object -Unique)

    $zip = [System.IO.Compression.ZipFile]::Open($sourcesZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relative in $allRelative) {
            $absolute = Join-Path $PSScriptRoot $relative
            if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { continue }
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $absolute,
                ("$topFolder/" + ($relative -replace '\\', '/')),
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    }
    finally {
        $zip.Dispose()
    }

    Write-Good "sources+vendor zip: $((Get-Item -LiteralPath $sourcesZipPath).Length) bytes, $($allRelative.Count) entries"
    Write-Note 'To rebuild offline: unzip, then powershell -File .\Package-Vendor.ps1 -Rewrite'
}

Write-Host ''
Write-Host "Packaged $script:PackageName $Version" -ForegroundColor Green
Write-Note "upload: $zipPath"
Write-Note '        chrome.google.com/webstore/devconsole -> this item -> Package -> Upload new package'
if ($IncludeVendor) {
    Write-Note "sources (offline rebuild): $(Join-Path $OutputPath "$script:PackageName-$Version-sources-vendored.zip")"
}
Write-Host ''
exit 0
