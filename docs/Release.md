# Release

Packaging is local and uploads are manual: `Publish-Extension.ps1` asks for the version, runs the tests, stamps the version,
builds `dist` and writes a versioned folder and zip under `artifacts\`.  
The zip goes to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) by hand.

## Build

`scripts/build.mjs` makes one build, which runs unpacked from `dist` and goes into the store zip as it is, minus its source maps:
`npm run build`, `npm run watch` or `node scripts/build.mjs`.  
`node scripts/build.mjs --outdir <folder>` builds into another folder instead of `dist`, such as a scratch folder for a check.  
It ships no HEIC decoder: HEIC pictures are HEVC, and HEVC is covered by patent pools,
so a HEIC shows a message, with its EXIF details and dimensions under **Info**; see [Preview](Preview.md#heic).  
TIFF, decoded by `utif2`, and EXIF, read by `exifr`, are bundled.

## 1. One-time store setup

1. Register a publisher account at the dashboard ($5, one-time).
2. Package locally so there is a zip to upload for the first time:
   ```powershell
   powershell -File .\Publish-Extension.ps1
   ```
   Press Enter at the prompt to accept the suggested version.
3. In the dashboard, **Add new item** and upload `artifacts\NibStudio-<version>.zip`.
4. Fill the listing: name, short and detailed description (see [Store listing](StoreListing.md)), category, a 128×128 icon,
   at least one 1280×800 or 640×400 screenshot, and a privacy policy URL (see [Privacy](Privacy.md)).
5. Under **Privacy practices**, paste the single purpose and the `storage` justification from [Store listing](StoreListing.md),
   state that no remote code is used, and certify that no user data is collected.
6. Submit for review.
   First-time reviews take longer; later updates usually take minutes to hours.

There are no host permissions to justify.

## 2. Release

Each time you want to ship a new version:

```powershell
powershell -File .\Publish-Extension.ps1
powershell -File .\Publish-Extension.ps1 -Version 1.0.1
powershell -File .\Publish-Extension.ps1 -Version 1.0.1 -IncludeVendor
```

The script:

1. Prints the current version from `public\manifest.json` and prompts for the new one; Enter accepts the suggested next patch.
   Pass `-Version 1.2.3`, or the version as the first argument, to skip the prompt.
   The version must be three dot-separated numbers and differ from the current one.
2. Stops when the output folder already holds a package for that version,
   `NibStudio-<version>\`, `NibStudio-<version>.zip` or `NibStudio-<version>-sources-vendored.zip`, and lists what it found.
   The check runs before the tests, so nothing is built or written.
   With `-Force` it goes on, and deletes all three once the tests and the build pass, just before writing the new package.
3. Runs `Invoke-Test.ps1 -Output None`, which makes sure Node.js 20 or later and the npm packages are there,
   installing what is missing, then type-checks with `tsc` and runs the Vitest suite:
   the `*.test.ts` files under `src` and the build scripts' `*.test.mjs` files under `scripts`.
   A failure stops the script before anything is written or built.
   With `-SkipTests`, it runs `Invoke-Test.ps1 -InstallOnly` instead, which only makes sure of Node.js and the npm packages.
4. Writes the new version into `public\manifest.json`, the source of truth; commit it.
   A step that fails after this leaves the new version in the file, so revert it before running again with the same version.
5. Builds `dist` with `node scripts/build.mjs`; see [Build](#build).
6. Copies the build, minus source maps, into `artifacts\NibStudio-<version>\` and zips it into `artifacts\NibStudio-<version>.zip`.
7. Verifies the zip: `manifest.json` at the root with the right version, no `.map` files, and these files present:
   `THIRD_PARTY_NOTICES.txt` at the root; `background.js`, `nib-studio/index.html`, `nib-studio/main.js` and `nib-studio/styles.css`;
   the image decode worker `nib-studio/imageDecodeWorker.js` and the Lookup worker `nib-studio/lookupWorker.js`;
   the HTML preview's sandbox page `nib-studio/sandbox.html` and its script `nib-studio/sandbox.js`;
   and pdf.js's `nib-studio/pdfjs/pdf.worker.min.mjs`, its JBIG2 and JPEG 2000 decoders under `nib-studio/pdfjs/wasm/`,
   and its `LICENSE`.
   It warns when the manifest has no icons.
8. With `-IncludeVendor`, runs `Package-Vendor.ps1` and writes `artifacts\NibStudio-<version>-sources-vendored.zip`; see below.

| Parameter | Meaning |
| --- | --- |
| `-Version` | Version to stamp, as `1.2.3`; also taken as the first argument. Omit to be prompted. |
| `-OutputPath` | Where the folder and zip go. Default `.\artifacts`. |
| `-SkipTests` | Package without the type check and the suite. |
| `-Force` | Replace an existing package for the version: its folder, its zip and its sources zip. Without it, the script stops when any of them exists. |
| `-IncludeVendor` | Also write a sources zip with every dependency tarball, for offline rebuilds. |

Exit codes: `0` packaged, `1` a step failed.

Then, in the dashboard:

1. Open the existing item.
2. **Package → Upload new package**, pick the zip.
3. Submit for review.

The store only takes dot-separated numbers and each upload must have a higher version than the previous one.

## Upload checklist

- [ ] The suite passed; the script stops otherwise.
- [ ] `public\manifest.json` carries the new version, and it is committed.
- [ ] The zip loads unpacked and opens the studio, see below.
- [ ] A folder opens, a file saves, and the light and dark themes look right.
- [ ] The About dialog lists every package the build ships,
  and `THIRD_PARTY_NOTICES.txt` at the zip root lists the same packages.
- [ ] A HEIC opened from the sideloaded zip shows **This picture can't be shown here**, with its details under **Info**.
- [ ] The listing text in [Store listing](StoreListing.md) still matches the features.
- [ ] The privacy policy URL points at the current [Privacy](Privacy.md).
- [ ] Screenshots show the current UI.

## Local sideload

The versioned folder next to the zip is handy for a smoke test before you submit:

1. `chrome://extensions → Developer mode on → Load unpacked`
2. Pick `artifacts\NibStudio-<version>\`.

## Offline sources

`-IncludeVendor` produces a zip from which the extension rebuilds without the npm registry:

1. `Package-Vendor.ps1` runs `npm pack` for every entry in `dependencies` and `devDependencies` into the gitignored `vendor\tarballs\`,
   reusing tarballs already there.
   SheetJS is skipped, since its tarball is already committed in `vendor\sheetjs\`,
   and so is any other dependency that already points at a `file:` tarball.
2. The script zips the files git would commit plus those tarballs under one `NibStudio-<version>-sources` folder.
   The file list comes from git; outside a git checkout, or without git,
   the script walks the folder and leaves out `node_modules`, `dist`, `artifacts`, `.debug-profile`, `.git`, `.playwright-mcp`, `*.log`,
   `*.zip` and `testResults.xml`.

On the target machine:

```powershell
powershell -File .\Package-Vendor.ps1 -Rewrite
node scripts/build.mjs
```

`-Rewrite` points every dependency in `package.json` at its `file:vendor/tarballs/...` tarball and runs `npm install` against them.  
It rewrites `package.json` and the lock file, so use it on the unzipped copy, not in the working repo.  
`Package-Vendor.ps1 -DryRun` reports what it would pack without packing or editing anything.  
`Package-Vendor.ps1` needs `npm` on the path and exits with `3` without it.

## SheetJS

The npm `xlsx` package is stuck at a version with a known advisory,
so SheetJS Community Edition comes from a tarball committed at `vendor\sheetjs\xlsx-latest.tgz`, and `package.json` points at it.  
See `vendor\sheetjs\README.md` for how to refresh it.

## Icons

```powershell
node scripts/generate-icons.mjs
```

Draws the 16, 32, 48 and 128 px icons into `public\icons\`: a white "N" on a blue-to-violet gradient.  
`public\manifest.json` references them for the toolbar and the store.  
The store listing needs the 128 px one.

## Third-party licences

Every build, watch builds included, collects the notices of everything it ships before it bundles,
with `scripts/collect-licenses.mjs`:

- **Bundled packages:** esbuild bundles `background`, `nib-studio/main`, the image decode worker,
  the Lookup worker and the sandbox page's script once without writing anything,
  and its metafiles name every file it took from `node_modules`.
  Each package folder among them is listed, a nested copy as its own entry,
  so both DOMPurify copies are there: ours and the one inside mermaid.
  A watch build collects them once, when it starts.
- **Copied packages:** the package files the build copies into `dist`:
  pdf.js's worker, CMaps, fonts and decoders.

For each package it reads the version and the licence from `package.json`, and the licence text from its
`LICENSE`, `LICENCE` or `COPYING` file, in any case and with any text extension, such as jszip's `LICENSE.markdown`.  
A package that ships none takes its text from `vendor\licenses\`, under its package name.  
Any `NOTICE` file the package ships follows its licence, as the Apache License asks.  
The build fails when a shipped package has no licence text in either place, naming each one.

Some packages need more, set once in `PACKAGE_RULES` in `scripts/collect-licenses.mjs`:

| Package | Recorded |
| --- | --- |
| `jszip` | MIT, elected from `(MIT OR GPL-3.0-or-later)`; the licences of pako, lie, immediate and setimmediate, which its prebuilt file inlines |
| `dompurify` | Apache-2.0, elected from `(MPL-2.0 OR Apache-2.0)`, with the Apache text from `LICENSE` |
| `elkjs` | EPL-2.0, elected from `EPL-2.0 OR GPL-3.0-or-later`, and where its source is: the npm package and the GitHub repository, at its exact version |
| `pdfjs-dist` | the licences of the JBIG2 and OpenJPEG decoders, the Foxit fonts and Adobe's CMaps it ships |
| `khroma` | MIT, which its `package.json` leaves out |

A package offered under a different licence choice than the one recorded stops the build, so the election is checked again.

The step writes two files:

- `src\nib-studio\vendorLicenses.ts`, which the About dialog lists, sorted by name and version.
  A licence text several packages share is written once.
  The file is only rewritten when its content changes.
- `dist\THIRD_PARTY_NOTICES.txt`, which ships at the root of the zip:
  the list of the packages the build ships with their versions and licences, then each licence text in full.
