#Requires -Version 5.1

<#
.SYNOPSIS
    Type-checks the sources and runs every Vitest unit test, the build scripts' included; fails if anything fails.

.DESCRIPTION
    Makes sure the tools are there first: Node.js (installed with winget when it is missing
    or too old) and the npm packages (restored with npm ci when node_modules is missing or
    older than package-lock.json). Then type-checks src with tsc, and runs Vitest over the
    co-located *.test.ts files under src and the *.test.mjs files of the build scripts under
    scripts. For local use and CI; Start-Debug.ps1 and Publish-Extension.ps1 call it too.

    Exit codes:
      0  all tests passed, or the tools are ready with -InstallOnly
      1  type errors, or one or more tests failed
      2  a test path was not found
      3  Node.js is missing or too old and could not be installed, or npm ci failed

.PARAMETER Path
    Test folders or files to run, as a list or as one comma-separated string, so -Path a,b
    works with powershell.exe -File too. Defaults to the src and scripts folders beside this script.

.PARAMETER TestName
    Only run tests whose name contains this text, or matches it as a regex.

.PARAMETER Output
    Vitest output: None, Normal, Detailed. Default Detailed.

.PARAMETER ResultPath
    Write JUnit XML test results to this path.

.PARAMETER Watch
    Rerun the affected tests on every save, until Ctrl+C. Skips the type check.

.PARAMETER SkipTypeCheck
    Run the tests without the tsc type check.

.PARAMETER MinimumNodeVersion
    Oldest Node.js major version accepted. Default 20.

.PARAMETER InstallOnly
    Make sure Node.js and the npm packages are there, then stop without running anything.

.PARAMETER SkipInstall
    Never install Node.js; fail instead. The npm packages still restore, since they stay
    inside the repo.

.EXAMPLE
    ./Invoke-Test.ps1

.EXAMPLE
    ./Invoke-Test.ps1 -Path ./src/common/markdown -Output Normal

.EXAMPLE
    ./Invoke-Test.ps1 -Path ./scripts

.EXAMPLE
    powershell.exe -File ./Invoke-Test.ps1 -Path ./src/common/markdown,./scripts

.EXAMPLE
    ./Invoke-Test.ps1 -TestName 'diff' -Watch

.EXAMPLE
    ./Invoke-Test.ps1 -InstallOnly
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path,

    [ValidateNotNullOrEmpty()]
    [string]$TestName,

    [ValidateSet('None', 'Normal', 'Detailed')]
    [string]$Output = 'Detailed',

    [ValidateNotNullOrEmpty()]
    [string]$ResultPath,

    [switch]$Watch,

    [switch]$SkipTypeCheck,

    [ValidateRange(18, 99)]
    [int]$MinimumNodeVersion = 20,

    [switch]$InstallOnly,

    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# powershell.exe -File leaves $PSScriptRoot empty in the param defaults of an advanced script.
if (-not $Path) { $Path = @('src', 'scripts') | ForEach-Object { Join-Path -Path $PSScriptRoot -ChildPath $_ } }

$script:NodePackageId = 'OpenJS.NodeJS.LTS'
$script:TestFilePatterns = @('*.test.ts', '*.test.mjs')
$script:Reporters = @{
    None = 'dot'
    Normal = 'default'
    Detailed = 'verbose'
}

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
        [Parameter(Mandatory)][ValidateRange(1, 255)][int]$ExitCode
    )
    Write-Host "   [fail] $Message" -ForegroundColor Red
    exit $ExitCode
}

# The major version of the node on PATH, or 0 when there is none.
function Get-NodeMajorVersion {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
    $text = (& node --version) -replace '^v', ''
    return [int]($text.Split('.')[0])
}

function Install-Node {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Exit-WithError "Node.js $MinimumNodeVersion+ is needed and winget is missing: install Node.js LTS from https://nodejs.org" 3
    }
    Write-Note "installing $script:NodePackageId with winget"
    & winget install --id $script:NodePackageId --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Exit-WithError "winget could not install $script:NodePackageId (exit $LASTEXITCODE)" 3 }
    # winget updates PATH for later sessions only; read it back for this one.
    $env:Path = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -join [System.IO.Path]::PathSeparator
}

# node_modules is current when npm's own record of it is newer than package-lock.json; a missing file means it is not.
function Test-PackagesCurrent {
    $nodeModules = Join-Path $PSScriptRoot 'node_modules'
    $lock = Join-Path $PSScriptRoot 'package-lock.json'
    $installed = Join-Path $PSScriptRoot 'node_modules/.package-lock.json'
    if (-not (Test-Path -LiteralPath $nodeModules)) { return $false }
    if (-not (Test-Path -LiteralPath $lock)) { return $false }
    if (-not (Test-Path -LiteralPath $installed)) { return $false }
    return (Get-Item -LiteralPath $installed).LastWriteTimeUtc -ge (Get-Item -LiteralPath $lock).LastWriteTimeUtc
}

# $Path below $BasePath, as [System.IO.Path]::GetRelativePath gives it; .NET Framework has
# no such method. $Path is a full path; one outside $BasePath comes back whole.
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

# The test paths as a list. powershell.exe -File passes -Path a,b as the one string 'a,b',
# while -Command and a call from another script pass a list; either way each comma-separated entry is a path.
function ConvertTo-TestPathList {
    param([Parameter(Mandatory)][string[]]$Path)

    return @($Path | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# The test files under a folder, or the file itself when it is one.
function Get-TestFile {
    param([Parameter(Mandatory)][string]$TestPath)

    $files = Get-ChildItem -LiteralPath $TestPath -Recurse -File
    return @($files | Where-Object {
        $name = $_.Name
        @($script:TestFilePatterns | Where-Object { $name -like $_ }).Count -gt 0
    })
}

function Get-VitestArguments {
    param([Parameter(Mandatory)][string[]]$RelativePath)

    $arguments = [System.Collections.Generic.List[string]]::new()
    $arguments.Add('vitest')
    if (-not $Watch) { $arguments.Add('run') }
    $arguments.AddRange($RelativePath)
    $arguments.Add("--reporter=$($script:Reporters[$Output])")
    if ($TestName) { $arguments.AddRange([string[]]@('--testNamePattern', $TestName)) }
    if ($ResultPath) {
        $resultFolder = Split-Path -Parent ([System.IO.Path]::GetFullPath($ResultPath))
        $null = New-Item -ItemType Directory -Path $resultFolder -Force
        $arguments.AddRange([string[]]@('--reporter=junit', "--outputFile.junit=$ResultPath"))
    }

    return $arguments.ToArray()
}

$Path = ConvertTo-TestPathList -Path $Path

Push-Location -LiteralPath $PSScriptRoot
try {
    Write-Step 'node'
    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -lt $MinimumNodeVersion) {
        $found = if ($nodeMajor -eq 0) { 'not found' } else { "v$nodeMajor found" }
        if ($SkipInstall) { Exit-WithError "Node.js $MinimumNodeVersion+ is needed, $found (-SkipInstall)" 3 }
        Write-Note "Node.js $MinimumNodeVersion+ is needed, $found"
        Install-Node
        $nodeMajor = Get-NodeMajorVersion
        if ($nodeMajor -lt $MinimumNodeVersion) {
            Exit-WithError "Node.js $MinimumNodeVersion+ is still not on PATH; open another terminal and run this again" 3
        }
    }
    Write-Good "node $(& node --version)"

    Write-Step 'packages'
    if (Test-PackagesCurrent) {
        Write-Good 'node_modules is current'
    }
    else {
        Write-Note 'node_modules is missing or older than package-lock.json; running npm install'
        if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package-lock.json')) {
            & npm ci --no-audit --no-fund | Out-Host
        }
        else {
            & npm install --no-audit --no-fund | Out-Host
        }
        if ($LASTEXITCODE -ne 0) { Exit-WithError "npm install failed (exit $LASTEXITCODE)" 3 }
        Write-Good 'restored'
    }

    if ($InstallOnly) { exit 0 }

    Write-Step 'tests'
    foreach ($testPath in $Path) {
        if (-not (Test-Path -LiteralPath $testPath)) { Exit-WithError "test path not found: $testPath" 2 }
    }
    $testFiles = @($Path | ForEach-Object { Get-TestFile -TestPath $_ })
    $patternText = $script:TestFilePatterns -join ' or '
    if ($testFiles.Count -eq 0) {
        Write-Note "no $patternText files under $($Path -join ', ') yet; skipping"
        exit 0
    }
    $relativePaths = @($Path | ForEach-Object {
        (Get-RelativePath -BasePath $PSScriptRoot -Path (Resolve-Path -LiteralPath $_).Path) -replace '\\', '/'
    })
    Write-Note "$($testFiles.Count) test files in $($relativePaths -join ', ')"

    if ($SkipTypeCheck -or $Watch) {
        Write-Note 'type check skipped'
    }
    else {
        & npx tsc --noEmit | Out-Host
        if ($LASTEXITCODE -ne 0) { Exit-WithError 'type check failed' 1 }
        Write-Good 'no type errors'
    }

    $vitestArguments = Get-VitestArguments -RelativePath $relativePaths
    & npx @vitestArguments | Out-Host
    if ($LASTEXITCODE -ne 0) { Exit-WithError 'tests failed' 1 }
    Write-Good 'all tests passed'
    if ($ResultPath) { Write-Note "results: $ResultPath" }
    Write-Host ''
    exit 0
}
finally {
    Pop-Location
}
