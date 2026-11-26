# vendor/

Vendored dependencies and licence texts.  
Three cases live here.

## vendor/sheetjs/ (committed)

The npm `xlsx` package is stuck at a version with a known advisory,
so SheetJS Community Edition comes from `cdn.sheetjs.com` instead.  
The tarball is committed and `package.json` points at it directly:

```json
"xlsx": "file:vendor/sheetjs/xlsx-latest.tgz"
```

See [sheetjs/README.md](sheetjs/README.md) for how to refresh it.

## vendor/licenses/ (committed)

The About dialog and `THIRD_PARTY_NOTICES.txt` list the licence of every package the build ships,
read from the licence file in its `node_modules` folder by `scripts/collect-licenses.mjs`.  
A package that ships without one has its licence text here instead, under its package name;
the build fails for a shipped package with licence text in neither place.  
Two packages need one:

- `@cfworker/json-schema`: its npm package has no licence file,
  so `licenses/@cfworker/json-schema/LICENSE.md` is a copy of the MIT licence from its GitHub repository.
- `brotli`, the WOFF2 decompressor the font preview uses: neither its npm package nor its GitHub repository has a licence file.
  Its `package.json` says MIT, and its decoder is a port of Google's Apache-2.0 Brotli decoder,
  so `licenses/brotli/LICENSE` holds the MIT licence, the decoder's Apache notice and the Apache License 2.0.

## vendor/tarballs/ (gitignored, built on demand)

Every other dependency comes from the npm registry during development.  
For an offline, reproducible rebuild,
`Publish-Extension.ps1 -IncludeVendor` runs `Package-Vendor.ps1` and then packages the result:

1. `Package-Vendor.ps1` runs `npm pack` for every entry in `dependencies` and `devDependencies` into `vendor/tarballs/`,
   reusing tarballs already there.
   SheetJS is skipped, and so is any other dependency that already points at a `file:` tarball.
2. `Publish-Extension.ps1` writes `artifacts/NibStudio-<version>-sources-vendored.zip`:
   the repo sources plus those tarballs.

`Package-Vendor.ps1` also runs on its own to fill `vendor/tarballs/` without packaging.

To rebuild from that zip on a machine without registry access:

```powershell
powershell -File .\Package-Vendor.ps1 -Rewrite
node scripts/build.mjs
```

`-Rewrite` reuses the tarballs already in `vendor/tarballs/`,
points every dependency in `package.json` at its `file:vendor/tarballs/...` tarball,
and runs `npm install` against them.  
It rewrites `package.json` and the lock file,
so use it on an unzipped snapshot, not in the working repo.

Run `Package-Vendor.ps1 -DryRun` to list what would be packed, without packing or editing anything.
