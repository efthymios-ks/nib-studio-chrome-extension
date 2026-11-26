import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import * as sass from 'sass';
import { writeThirdPartyNoticesAsync } from './collect-licenses.mjs';

const ROOT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WATCH_MODE = process.argv.includes('--watch');

// `--outdir <path>` builds somewhere other than `dist`, such as a scratch folder, leaving `dist` as it is.
function readOutputDirectory() {
    const index = process.argv.indexOf('--outdir');

    if (index < 0) {
        return join(ROOT_DIRECTORY, 'dist');
    }

    const path = process.argv[index + 1];

    if (path == null || path.startsWith('--')) {
        console.error('--outdir needs a folder, such as: node scripts/build.mjs --outdir ../scratch/dist');
        process.exit(1);
    }

    return resolve(path);
}

const OUTPUT_DIRECTORY = readOutputDirectory();

// pdf.js's worker and the data it loads while it reads a PDF ship beside main.js,
// so a PDF opens without the network.
// The worker is the legacy build's, like the bundled library, so it runs on every Chrome the manifest allows.
// The standard fonts are only Symbol and Dingbats, the two pdf.js never takes from the system,
// and the JBIG2 and JPEG 2000 decoders are the JavaScript ones, since the CSP allows no WebAssembly.
const PDFJS_FILES = [
    'LICENSE',
    'legacy/build/pdf.worker.min.mjs',
    'cmaps',
    'standard_fonts/FoxitSymbol.pfb',
    'standard_fonts/FoxitDingbats.pfb',
    'standard_fonts/LICENSE_FOXIT',
    'wasm/jbig2_nowasm_fallback.js',
    'wasm/openjpeg_nowasm_fallback.js',
    'wasm/LICENSE_JBIG2',
    'wasm/LICENSE_PDFJS_JBIG2',
    'wasm/LICENSE_OPENJPEG',
    'wasm/LICENSE_PDFJS_OPENJPEG',
];

const PDFJS_ASSETS = PDFJS_FILES.map((path) => ({
    from: join(ROOT_DIRECTORY, 'node_modules', 'pdfjs-dist', path),
    to: join(OUTPUT_DIRECTORY, 'nib-studio', 'pdfjs', path.replace(/^legacy\/build\//, '')),
}));

const STATIC_ASSETS = [
    {
        from: join(ROOT_DIRECTORY, 'public'),
        to: OUTPUT_DIRECTORY,
    },
    {
        from: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'index.html'),
        to: join(OUTPUT_DIRECTORY, 'nib-studio', 'index.html'),
    },
    {
        from: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'sandbox.html'),
        to: join(OUTPUT_DIRECTORY, 'nib-studio', 'sandbox.html'),
    },
    ...PDFJS_ASSETS,
];

const SCSS_ENTRIES = [
    {
        from: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'styles.scss'),
        to: join(OUTPUT_DIRECTORY, 'nib-studio', 'styles.css'),
    },
];

const BUILD_OPTIONS = {
    entryPoints: [
        {
            in: join(ROOT_DIRECTORY, 'src', 'background', 'main.ts'),
            out: 'background',
        },
        {
            in: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'main.ts'),
            out: 'nib-studio/main',
        },
    ],
    outdir: OUTPUT_DIRECTORY,
    bundle: true,
    format: 'esm',
    target: 'chrome126',
    sourcemap: true,
    logLevel: 'info',
};

// Classic scripts: the image decoding and Lookup workers, and the sandbox page's script,
// which a page with an opaque origin loads without CORS.
const CLASSIC_BUILD_OPTIONS = {
    entryPoints: [
        {
            in: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'imageDecodeWorker.ts'),
            out: 'nib-studio/imageDecodeWorker',
        },
        {
            in: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'lookupWorker.ts'),
            out: 'nib-studio/lookupWorker',
        },
        {
            in: join(ROOT_DIRECTORY, 'src', 'nib-studio', 'sandbox.ts'),
            out: 'nib-studio/sandbox',
        },
    ],
    outdir: OUTPUT_DIRECTORY,
    bundle: true,
    format: 'iife',
    target: 'chrome126',
    sourcemap: true,
    logLevel: 'info',
};

// The inputs each bundle takes, from a build that writes nothing, for the third-party notices.
async function readMetafilesAsync() {
    const metafiles = [];

    for (const options of [BUILD_OPTIONS, CLASSIC_BUILD_OPTIONS]) {
        const result = await esbuild.build({
            ...options,
            absWorkingDir: ROOT_DIRECTORY,
            write: false,
            metafile: true,
            sourcemap: false,
            logLevel: 'silent',
        });
        metafiles.push(result.metafile);
    }

    return metafiles;
}

// The notices cover every package the bundles take code from and every package file the build copies.
// A watch build collects them once, when it starts.
async function writeNoticesAsync() {
    const count = await writeThirdPartyNoticesAsync({
        rootDirectory: ROOT_DIRECTORY,
        metafiles: await readMetafilesAsync(),
        copiedPaths: STATIC_ASSETS.map((asset) => asset.from),
        outputDirectory: OUTPUT_DIRECTORY,
    });
    console.log(`Third-party notices: ${count} packages ship in the build.`);
}

async function copyStaticAssetsAsync() {
    for (const asset of STATIC_ASSETS) {
        await mkdir(dirname(asset.to), { recursive: true });
        await cp(asset.from, asset.to, { recursive: true });
    }
}

async function compileScssAsync() {
    for (const entry of SCSS_ENTRIES) {
        const result = sass.compile(entry.from, {
            style: 'expanded',
            sourceMap: true,
        });

        await mkdir(dirname(entry.to), { recursive: true });
        await writeFile(entry.to, result.css, 'utf-8');

        if (result.sourceMap != null) {
            await writeFile(`${entry.to}.map`, JSON.stringify(result.sourceMap), 'utf-8');
        }
    }
}

function watchStaticAssets() {
    for (const asset of STATIC_ASSETS) {
        watch(asset.from, { recursive: true }, () => {
            void (async () => {
                try {
                    await copyStaticAssetsAsync();
                }
                catch (error) {
                    console.error('Copying static files failed.', error);
                }
            })();
        });
    }
}

function watchScss() {
    watch(join(ROOT_DIRECTORY, 'src', 'nib-studio'), { recursive: true }, (_eventType, filename) => {
        if (filename != null && !filename.endsWith('.scss')) {
            return;
        }

        void (async () => {
            try {
                await compileScssAsync();
            }
            catch (error) {
                console.error('SCSS compile failed.', error);
            }
        })();
    });
}

await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeNoticesAsync();
await copyStaticAssetsAsync();
await compileScssAsync();

if (IS_WATCH_MODE) {
    for (const options of [BUILD_OPTIONS, CLASSIC_BUILD_OPTIONS]) {
        const context = await esbuild.context(options);
        await context.watch();
    }

    watchStaticAssets();
    watchScss();
}
else {
    await esbuild.build(BUILD_OPTIONS);
    await esbuild.build(CLASSIC_BUILD_OPTIONS);
}
