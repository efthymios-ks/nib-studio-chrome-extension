# SheetJS Community Edition (vendored)

Nib Studio reads `.xlsx` and `.xls` files with SheetJS Community Edition (Apache-2.0).  
It is installed from the committed tarball `vendor/sheetjs/xlsx-latest.tgz`,
not from the npm registry.

## Why not npm

- `xlsx@0.18.5`, the last version on the public npm registry, has a high-severity advisory.
- The SheetJS team publishes Community Edition from <https://cdn.sheetjs.com>,
  which is the canonical source.

## How it is wired

`package.json` declares `"xlsx": "file:vendor/sheetjs/xlsx-latest.tgz"`,
so a normal `npm install` or `npm ci` installs it into `node_modules/xlsx`.  
`src/common/office/xlsxLoader.ts` imports `xlsx` and esbuild bundles it into the extension;
nothing is fetched at runtime.  
`Package-Vendor.ps1` skips it because it is already vendored.  
Its license text reaches the About dialog through `scripts/collect-licenses.mjs`.

## How to refresh

```powershell
Invoke-WebRequest -Uri 'https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz' -OutFile .\vendor\sheetjs\xlsx-latest.tgz
npm install --ignore-scripts
node scripts/collect-licenses.mjs
```

Then run the tests and commit the new tarball together with `package-lock.json` and `src/nib-studio/vendorLicenses.ts`.
