# Nib Studio

A Chromium extension to write, compare and inspect files, fully offline.  
Pick a folder on your disk, or drop files onto the studio, and work on them in a browser tab:
edit text, JSON, YAML, XML, Markdown and HTML,
preview HTML pages with their own scripts running in a sandbox, with no network,
query JSON and YAML with JSONPath and XML with XPath,
format YAML and convert it to and from JSON,
validate JSON against a schema, generate a schema from it or build a sample from one,
compare any two files or texts side by side in diff tabs and export the diff as JSON or HTML,
view and query CSV and Excel files, every sheet of a workbook included,
and preview Word documents, PDFs, images, TIFF included, audio, video and fonts.  
HEIC photos aren't decoded, so a HEIC shows its details only.  
**Paste from clipboard** opens what is on the clipboard in a tab of its own,
and **Copy raw**, **Copy formatted** or **Copy content** on a file's toolbar copies its text or what it renders as.  
**Lookup** finds files by name and by content as you type, inside Word, Excel, PowerPoint and PDF files too.  
Hash, HMAC, checksum, encoding and JWT tools sit one tab away.  
No host permissions, no network access; everything stays on the machine.  
Click the toolbar icon to open the studio; the interface is in English.

## Contents

- [Features](docs/Features.md): every feature in one list, with how to reach it, and what is not supported
- [Overview](docs/Overview.md): runtime, layout, architecture, permissions, workspace model
- [Workspaces](docs/Workspaces.md): opening folders, the workspace switcher, permissions on reopen, the configuration file, live refresh
- [Explorer](docs/Explorer.md): tree, selection, keyboard, context menu, drag and drop, desktop drop, hiding and resizing,
  the narrow-screen drawer
- [Lookup](docs/Lookup.md): find files by name and content from the box at the top of the Explorer,
  how it matches and ranks, the preview, what it reads, and protected files
- [Editor](docs/Editor.md): preview and permanent tabs, view tabs per file type, the editor bar with undo and redo,
  saving, line endings and text encodings, keys, undo across views,
  drop to open and tabs of files from outside the workspace, the HTML preview with the page's scripts in a sandbox,
  the copy buttons and Paste from clipboard
- [JSON](docs/Json.md): tree with a JSONPath path bar, format and minify, JSONPath results, schema validate, generate and sample
- [YAML](docs/Yaml.md): validator, format that keeps comments, tree, JSONPath and schema views,
  conversion rules, Convert YAML to JSON and JSON to YAML, the structural diff
- [XML](docs/Xml.md): tree with an XPath path bar, XPath, As JSON, conversion rules, Convert XML to JSON, paths in the diff
- [Markdown](docs/Markdown.md): Interactive editing with the formatting shown, tables, code blocks and diagrams edited in place,
  split and preview, formatting buttons, list keys, paste from web pages and Word, Mermaid, code copy, heading ids,
  workspace images and links, sanitised raw HTML,
  HTML and PDF export, and conversion to an HTML page and back
- [Compare](docs/Compare.md): diff tabs, Compare with…, the diff bar, text, JSON with array rules, YAML, XML, Markdown and row diffs,
  JSON and HTML exports
- [Tables](docs/Tables.md): CSV, TSV and Excel grids with sheet tabs, sort, filters, search, columns, queries
  and large-file streaming
- [Documents](docs/Documents.md): Word preview of DOCX and `.doc` files with zoom, find, passwords and the Info panel,
  PDF preview with zoom, Fit page, a page box, Save pages, find, selectable text, passwords and the Info panel
- [Preview](docs/Preview.md): images, TIFF included, audio, video and fonts, with zoom, Copy image and the Info panel,
  and the details of HEIC photos
- [Hash and encode](docs/HashAndEncode.md): MD5 and SHA digests of text or files, checksum verify, HMAC,
  Base64, URL, hex and HTML encoding, JWT decode
- [Theme](docs/Theme.md): light and dark tokens and where the palette comes from
- [Release](docs/Release.md): packaging, Chrome Web Store upload, offline sources, icons and licences
- [Store listing](docs/StoreListing.md): the Chrome Web Store description
- [Privacy](docs/Privacy.md): what the extension reads and where it stays

## Quick start

Needs Windows PowerShell 5.1.

```powershell
powershell -File .\Start-Debug.ps1
```

Installs Node.js and the npm packages when they're missing, then opens Chrome with its own profile, the extension loaded,
and a rebuild on every save.  
Click the toolbar icon to open Nib Studio, then **Choose folder**.

Branded Chrome 137+ ignores `--load-extension`.  
On the first run there, turn on Developer mode in `chrome://extensions`, click "Load unpacked" and pick `dist`.  
The debug profile keeps it.

## Test

```powershell
powershell -File .\Invoke-Test.ps1                                 # type check, then every test
powershell -File .\Invoke-Test.ps1 -Path .\src\common\markdown     # one folder
powershell -File .\Invoke-Test.ps1 -Path .\src\common,.\scripts    # several, comma-separated
powershell -File .\Invoke-Test.ps1 -TestName 'diff'                # by name
powershell -File .\Invoke-Test.ps1 -Watch                          # rerun on save
powershell -File .\Invoke-Test.ps1 -ResultPath .\testResults.xml   # JUnit XML
powershell -File .\Invoke-Test.ps1 -InstallOnly                    # only Node.js and the npm packages
```

Makes sure the tools are there first.  
Node.js is installed with winget when it is missing or older than 20,
and `npm ci` runs when `node_modules` is missing or older than `package-lock.json`.  
Then it type-checks `src` and runs Vitest over the co-located `*.test.ts` files under `src`
and the build scripts' `*.test.mjs` files under `scripts`.  
`Start-Debug.ps1` and `Publish-Extension.ps1` go through the same install step.  
Exit codes: `0` passed, `1` type errors or failures, `2` a test path not found, `3` Node.js or the npm packages unavailable.

With Node.js and the packages in place, `npm test` (or `npx vitest run`) runs the same suite directly.  
`vitest.config.ts` splits it into two projects:
`logic` runs `src/common`, `src/background` and the `scripts/*.test.mjs` files under Node,
and `studio` runs `src/nib-studio` under happy-dom.  
Run one with `npx vitest run --project studio`.  
A `src/common` test that builds HTML asks for happy-dom in its first line, `// @vitest-environment happy-dom`.  
Tests that touch the disk use the in-memory File System Access fake in `src/common/fs/testing/fakeFileSystem.ts`,
so no test reads or writes real files.  
Drops from the desktop use the `DataTransfer` fake in `src/nib-studio/testing/fakeDataTransfer.ts`,
which empties its items once the drop event is over, as the browser does.

| Parameter | Meaning |
| --- | --- |
| `-Path` | Test folders or files, as a list or comma-separated. Default `.\src` and `.\scripts`. |
| `-TestName` | Only tests whose name contains this text, or matches it as a regex. |
| `-Output` | `None`, `Normal` or `Detailed`. Default `Detailed`. |
| `-ResultPath` | Also write JUnit XML to this path. |
| `-Watch` | Rerun on save, without the type check. |
| `-SkipTypeCheck` | Run the tests only. |
| `-MinimumNodeVersion` | Oldest Node.js major accepted. Default `20`. |
| `-InstallOnly` | Make sure Node.js and the npm packages are there, then stop. |
| `-SkipInstall` | Never install Node.js; fail instead. Packages still restore. |

## Debug

```powershell
powershell -File .\Start-Debug.ps1
powershell -File .\Start-Debug.ps1 -Browser Edge
powershell -File .\Start-Debug.ps1 -BrowserPath 'C:\Tools\chrome-for-testing\chrome.exe'
powershell -File .\Start-Debug.ps1 -NoWatch
```

- After a rebuild, press the reload icon on the extension card in `chrome://extensions`, then reload the studio tab.
- Studio tab DevTools: `F12` on the open tab.
- Worker DevTools: the "service worker" link on the extension card.
- Source maps are on, so breakpoints work in the TypeScript files.

| Parameter | Meaning |
| --- | --- |
| `-Browser` | `Chrome`, `Edge` or `Chromium`. Default `Chrome`. |
| `-BrowserPath` | Explicit executable, for example Chrome for Testing. |
| `-ProfilePath` | Browser profile. Default `.debug-profile`. |
| `-NoWatch` | Build once, open the browser and return. |

## Build and package

```powershell
node scripts/build.mjs                                                    # build dist
powershell -File .\Publish-Extension.ps1                                  # prompts for the new version
powershell -File .\Publish-Extension.ps1 -Version 1.0.1                   # non-interactive
powershell -File .\Publish-Extension.ps1 -Version 1.0.1 -IncludeVendor    # plus an offline sources zip
```

The suite runs first.  
A red test stops the script before anything is built.  
The new version is written into `public\manifest.json`, then the build picks it up.  
Output lands in `artifacts\NibStudio-<version>\` (loose folder for sideloading) and `artifacts\NibStudio-<version>.zip` (for upload),
both without source maps.  
With `-IncludeVendor` it also writes `artifacts\NibStudio-<version>-sources-vendored.zip`, which rebuilds without the npm registry.  
When any of those three already exists for the version, the script lists it and stops before the tests;
`-Force` replaces them instead.

Called without `-Version`, the script prints the current version from `public\manifest.json` and prompts for the new one,
suggesting the next patch.

| Parameter | Meaning |
| --- | --- |
| `-Version` | Version to stamp, as `1.2.3`. Omit to be prompted. |
| `-OutputPath` | Where the folder and zip go. Default `.\artifacts`. |
| `-SkipTests` | Package without the suite. |
| `-Force` | Replace an existing package for the version: folder, zip and sources zip. |
| `-IncludeVendor` | Also write a sources zip with every dependency tarball. |

Generated files:

```powershell
node scripts/generate-icons.mjs     # public/icons/icon-16|32|48|128.png, rerun by hand
```

Every build first collects the third-party notices of every package it ships, read from esbuild's metafiles,
into `src/nib-studio/vendorLicenses.ts`, which the About dialog lists, and `dist/THIRD_PARTY_NOTICES.txt`, which ships in the zip.

Upload the zip by hand in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).  
See [Release](docs/Release.md) for the full checklist, offline sources, SheetJS and licences.

## Source zip

```powershell
.\Compress-Source.ps1   # .\nib-studio-chrome-extension.zip, without node_modules, dist, artifacts or .debug-profile
```

Zips every file git would commit, under one `nib-studio-chrome-extension` folder, and replaces the previous zip.  
Deletes nothing.  
Without git, it leaves out the same folders by name.  
Like every script here, it runs on Windows PowerShell 5.1,
so right-clicking it in Explorer and choosing **Run with PowerShell** works.

## Licence

[MIT](LICENSE), Efthymios Koktsidis.
