#Requires -Version 5.1

<#
.SYNOPSIS
    Packs every runtime and dev dependency into vendor/tarballs/ so the repo can
    be rebuilt without reaching the npm registry.

.DESCRIPTION
    For every entry in package.json's dependencies and devDependencies, runs
    `npm pack <name>@<version>` and places the result under vendor/tarballs/.

    The packed tarballs are gitignored. They are produced on demand, typically
    by Publish-Extension.ps1 -IncludeVendor, which bundles them next to the
    extension zip for offline rebuilds.

    SheetJS is excluded automatically: its tarball is committed under
    vendor/sheetjs/ because the npm version has a published advisory.

    Tarballs already in vendor/tarballs/ are reused, so an unzipped sources+vendor
    archive rewrites without touching the registry.

    By default this only packs tarballs. Pass -Rewrite to also rewrite
    package.json so every dependency points at `file:vendor/tarballs/...`. The
    rewrite is destructive to the lock file and is intended for a sealed
    offline snapshot, not day-to-day development.

    Exit codes:
      0  packed
      1  a step failed
      3  Node or npm unavailable

.PARAMETER DryRun
    Report what would be packed; pack nothing, edit nothing.

.PARAMETER Rewrite
    After packing, rewrite package.json to point every dep at its local
    tarball and run `npm install` to lock against them.

.EXAMPLE
    powershell -File .\Package-Vendor.ps1

.EXAMPLE
    powershell -File .\Package-Vendor.ps1 -DryRun

.EXAMPLE
    powershell -File .\Package-Vendor.ps1 -Rewrite
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Rewrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Root = $PSScriptRoot
$script:TarballFolder = Join-Path $script:Root 'vendor/tarballs'
$script:ManifestPath = Join-Path $script:Root 'package.json'
$script:SkipPackages = @('xlsx')

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

function Exit-WithError {
    param(
        [Parameter(Mandatory)][string]$Message,
        [Parameter(Mandatory)][int]$ExitCode
    )
    Write-Host "   [fail] $Message" -ForegroundColor Red
    exit $ExitCode
}

function Get-DependencySpecs {
    $raw = Get-Content -LiteralPath $script:ManifestPath -Raw -Encoding UTF8
    $manifest = $raw | ConvertFrom-Json
    $specs = [System.Collections.Generic.List[pscustomobject]]::new()

    foreach ($group in @('dependencies', 'devDependencies')) {
        $section = $manifest.$group
        if (-not $section) { continue }
        foreach ($property in $section.PSObject.Properties) {
            if ($script:SkipPackages -contains $property.Name) {
                Write-Note "skipping $($property.Name) (vendored by hand)"
                continue
            }
            if ($property.Value -like 'file:*') {
                Write-Note "$($property.Name) already vendored"
                continue
            }
            $specs.Add([pscustomobject]@{
                Name = $property.Name
                Version = ($property.Value -replace '^[\^~<>=\s]+', '')
                Group = $group
            })
        }
    }

    return @{ Manifest = $manifest; Specs = $specs.ToArray(); Raw = $raw }
}

function Invoke-Pack {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Version
    )

    Push-Location -LiteralPath $script:TarballFolder
    try {
        & npm pack "$Name@$Version" --silent | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "npm pack $Name@$Version failed (exit $LASTEXITCODE)" }
    }
    finally {
        Pop-Location
    }
}

function Get-TarballFileName {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Version
    )

    $safeName = $Name -replace '^@', '' -replace '/', '-'
    return "$safeName-$Version.tgz"
}

function Find-Tarball {
    param([Parameter(Mandatory)][string]$Name)

    $safeName = $Name -replace '^@', '' -replace '/', '-'
    $pattern = "$safeName-*.tgz"
    $match = Get-ChildItem -LiteralPath $script:TarballFolder -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $match) { throw "no tarball found for $Name" }
    return $match
}

function Update-Manifest {
    param(
        [Parameter(Mandatory)][object]$Manifest,
        [Parameter(Mandatory)][hashtable]$ByName
    )

    foreach ($group in @('dependencies', 'devDependencies')) {
        $section = $Manifest.$group
        if (-not $section) { continue }
        foreach ($property in $section.PSObject.Properties) {
            if ($ByName.ContainsKey($property.Name)) {
                $section.$($property.Name) = "file:vendor/tarballs/$($ByName[$property.Name])"
            }
        }
    }

    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine('{')
    $topProps = @('name', 'version', 'private', 'description', 'author', 'license', 'type', 'scripts', 'dependencies', 'devDependencies')
    for ($i = 0; $i -lt $topProps.Count; $i++) {
        $name = $topProps[$i]
        if ($null -eq $Manifest.$name) { continue }
        [void]$builder.Append("  ""$name"": ")
        [void]$builder.Append((Format-ManifestValue -Value $Manifest.$name -Indent '  '))
        if ($i -lt $topProps.Count - 1) { [void]$builder.Append(',') }
        [void]$builder.AppendLine()
    }
    [void]$builder.AppendLine('}')
    [System.IO.File]::WriteAllText($script:ManifestPath, $builder.ToString(), (New-Object System.Text.UTF8Encoding $false))
}

function Format-ManifestValue {
    param(
        [Parameter(Mandatory)][AllowNull()]$Value,
        [Parameter(Mandatory)][string]$Indent
    )

    if ($Value -is [bool]) { return $Value.ToString().ToLower() }
    if ($Value -is [string]) { return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"' }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double]) { return $Value.ToString() }

    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine('{')
    $properties = @($Value.PSObject.Properties)
    for ($i = 0; $i -lt $properties.Count; $i++) {
        $property = $properties[$i]
        [void]$builder.Append($Indent + '  "' + $property.Name + '": ')
        [void]$builder.Append((Format-ManifestValue -Value $property.Value -Indent ($Indent + '  ')))
        if ($i -lt $properties.Count - 1) { [void]$builder.Append(',') }
        [void]$builder.AppendLine()
    }
    [void]$builder.Append($Indent + '}')
    return $builder.ToString()
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Exit-WithError 'npm is not on PATH. Install Node.js (Start-Debug.ps1 does this).' 3
}

if (-not (Test-Path -LiteralPath $script:TarballFolder)) {
    $null = New-Item -ItemType Directory -Path $script:TarballFolder -Force
}

Write-Step 'inventory'
$inventory = Get-DependencySpecs
$specs = $inventory.Specs
Write-Note "$($specs.Count) packages to pack"

if ($DryRun) {
    foreach ($spec in $specs) {
        Write-Note ("  {0}@{1}  ({2})" -f $spec.Name, $spec.Version, $spec.Group)
    }
    Write-Note 'dry run; nothing was packed or rewritten'
    exit 0
}

Write-Step 'pack'
$nameToTarball = @{}
foreach ($spec in $specs) {
    $expectedName = Get-TarballFileName -Name $spec.Name -Version $spec.Version
    if (Test-Path -LiteralPath (Join-Path $script:TarballFolder $expectedName)) {
        $nameToTarball[$spec.Name] = $expectedName
        Write-Note "$($spec.Name)@$($spec.Version) already packed"
        continue
    }

    Invoke-Pack -Name $spec.Name -Version $spec.Version
    $tarball = Find-Tarball -Name $spec.Name
    $nameToTarball[$spec.Name] = $tarball.Name
    Write-Good "$($spec.Name)@$($spec.Version) -> $($tarball.Name)"
}

if (-not $Rewrite) {
    Write-Host ''
    Write-Host "Packed $($specs.Count) tarballs into vendor/tarballs/" -ForegroundColor Green
    Write-Note 'Pass -Rewrite to also point package.json at them and re-install.'
    Write-Host ''
    exit 0
}

Write-Step 'rewrite package.json'
Update-Manifest -Manifest $inventory.Manifest -ByName $nameToTarball
Write-Good 'package.json points at vendor/tarballs/*.tgz'

Write-Step 'npm install (from local)'
& npm install --no-audit --no-fund | Out-Host
if ($LASTEXITCODE -ne 0) { Exit-WithError "npm install from local tarballs failed (exit $LASTEXITCODE)" 1 }
Write-Good 'done'

Write-Host ''
Write-Host "Packed and rewrote $($specs.Count) packages" -ForegroundColor Green
Write-Host ''
exit 0
