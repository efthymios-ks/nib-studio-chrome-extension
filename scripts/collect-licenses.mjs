import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

// The third-party notices of a build: every package esbuild bundles, read from the build's metafiles,
// and every package whose files the build copies, such as pdf.js's worker.
// Each gets its version, its license and the full license text;
// a shipped package without license text fails the build.
// They go to src/nib-studio/vendorLicenses.ts, which the About dialog lists,
// and to THIRD_PARTY_NOTICES.txt in dist.

const NOTICES_FILE_NAME = 'THIRD_PARTY_NOTICES.txt';

const NODE_MODULES = 'node_modules/';
const SECTION_BREAK = '\n\n\n';
const RULE = '='.repeat(80);

// A license file is LICENSE, LICENCE or COPYING, in any case, with a suffix such as `.md` or `-MIT.txt`;
// a script such as cytoscape's license-update.mjs is not one.
const LICENSE_FILE = /^(licen[cs]e|copying)/i;
const NOTICE_FILE = /^notice/i;
const TEXT_EXTENSIONS = new Set(['', '.md', '.markdown', '.txt', '.rst']);

// What a package needs beyond its own license file, by package name:
// - `license` names the license for a package whose package.json has none.
// - `elected` is the license Nib Studio takes a dual-licensed package under,
// `offered` the choice its package.json gives,
//   and `file` the license file that holds the elected text when the package ships more than one.
// - `parts` are licenses of code the package ships inside its own files, each from a file of the package,
//   by `path`, or from another package, by `package`.
// - `statement` says where the source is and how the package ships, as its license asks.
const PACKAGE_RULES = Object.freeze({
    'dompurify': {
        elected: 'Apache-2.0',
        offered: '(MPL-2.0 OR Apache-2.0)',
        file: 'LICENSE',
    },
    'elkjs': {
        elected: 'EPL-2.0',
        offered: 'EPL-2.0 OR GPL-3.0-or-later',
        statement: (version) => [
            `Source code: Nib Studio bundles elkjs ${version} into nib-studio/main.js without changing its code.`,
            `Its source code is available from the npm package elkjs@${version},`,
            `https://www.npmjs.com/package/elkjs/v/${version},`,
            'and from its repository, https://github.com/kieler/elkjs,',
            'which builds it from the Eclipse Layout Kernel, https://github.com/eclipse/elk.',
        ].join('\n'),
    },
    'jszip': {
        elected: 'MIT',
        offered: '(MIT OR GPL-3.0-or-later)',
        parts: [
            { title: 'pako, inlined in jszip\'s prebuilt file', package: 'pako' },
            { title: 'lie, inlined in jszip\'s prebuilt file', package: 'lie' },
            { title: 'immediate, inlined in jszip\'s prebuilt file', package: 'immediate' },
            { title: 'setimmediate, inlined in jszip\'s prebuilt file', package: 'setimmediate' },
        ],
    },
    'khroma': {
        license: 'MIT',
    },
    'pdfjs-dist': {
        parts: [
            { title: 'JBIG2 decoder (PDFium)', path: 'wasm/LICENSE_JBIG2' },
            { title: 'JBIG2 decoder build (PDF.js)', path: 'wasm/LICENSE_PDFJS_JBIG2' },
            { title: 'OpenJPEG decoder', path: 'wasm/LICENSE_OPENJPEG' },
            { title: 'OpenJPEG decoder build (PDF.js)', path: 'wasm/LICENSE_PDFJS_OPENJPEG' },
            { title: 'Foxit standard fonts', path: 'standard_fonts/LICENSE_FOXIT' },
            { title: 'Adobe CMaps', path: 'cmaps/LICENSE' },
        ],
    },
});

// The package folder a path lies in, from the workspace root with forward slashes, such as
// `node_modules/mermaid/node_modules/dompurify`; null for a path outside node_modules.
export function packageDirectoryOf(path) {
    const normalized = path.replaceAll('\\', '/');
    const index = normalized.lastIndexOf(NODE_MODULES);

    if (index < 0) {
        return null;
    }

    const segments = normalized.slice(index + NODE_MODULES.length).split('/');
    const name = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];

    return name == null || name === '' ? null : normalized.slice(0, index + NODE_MODULES.length) + name;
}

// `dompurify` for `node_modules/mermaid/node_modules/dompurify`.
export function packageNameOf(directory) {
    return directory.slice(directory.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

// Every package folder the bundles take code from, read from esbuild metafiles, sorted; a package nested
// under another, such as mermaid's own copy of DOMPurify, is a package of its own.
export function bundledPackageDirectories(metafiles) {
    const directories = new Set();

    for (const metafile of metafiles) {
        for (const input of Object.keys(metafile.inputs ?? {})) {
            const directory = packageDirectoryOf(input);

            if (directory != null) {
                directories.add(directory);
            }
        }
    }

    return [...directories].sort();
}

function isTextFile(fileName) {
    return TEXT_EXTENSIONS.has(extname(fileName).toLowerCase());
}

// The license file of a package, the shortest name first, so `LICENSE` wins over `LICENSE-MPL`;
// null when there is none.
export function pickLicenseFile(fileNames) {
    const candidates = fileNames
        .filter((fileName) => LICENSE_FILE.test(fileName) && isTextFile(fileName))
        .sort((left, right) => left.length - right.length || left.localeCompare(right));

    return candidates[0] ?? null;
}

// The NOTICE files of a package, such as the one the Apache License asks to pass on.
export function pickNoticeFiles(fileNames) {
    return fileNames
        .filter((fileName) => NOTICE_FILE.test(fileName) && isTextFile(fileName))
        .sort();
}

// The license of a package.json: the `license` string, an old `license` object, or the `licenses` list.
export function manifestLicense(manifest) {
    if (typeof manifest.license === 'string') {
        return manifest.license;
    }

    if (typeof manifest.license?.type === 'string') {
        return manifest.license.type;
    }

    const types = (manifest.licenses ?? []).map((license) => license?.type).filter((type) => typeof type === 'string');

    return types.length === 0 ? null : types.join(' OR ');
}

// By name, then by version in number order, so DOMPurify 3.4.7 comes before 3.4.18.
export function compareNotices(left, right) {
    if (left.name !== right.name) {
        return left.name < right.name ? -1 : 1;
    }

    return left.version.localeCompare(right.version, 'en', { numeric: true });
}

// Unix line breaks, without blank lines at either end; the first line keeps its indent,
// as license headings have one.
function normalizeText(text) {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/^\s*\n/, '')
        .trimEnd();
}

async function listFilesAsync(directory) {
    try {
        const entries = await readdir(directory, { withFileTypes: true });

        return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    }
    catch {
        return [];
    }
}

async function readTextAsync(path) {
    return normalizeText(await readFile(path, 'utf-8'));
}

// A package the given one depends on: its own nested copy first, then the one at the top of node_modules.
async function resolvePackageDirectoryAsync(rootDirectory, fromDirectory, name) {
    for (const candidate of [`${fromDirectory}/${NODE_MODULES}${name}`, `${NODE_MODULES}${name}`]) {
        if ((await listFilesAsync(join(rootDirectory, candidate))).includes('package.json')) {
            return candidate;
        }
    }

    return null;
}

// The license text of a package folder, from its own files or, for one that ships none, from vendor/licenses.
async function readLicenseTextAsync(rootDirectory, directory, preferredFile) {
    const name = packageNameOf(directory);
    const folders = [join(rootDirectory, directory), join(rootDirectory, 'vendor', 'licenses', name)];

    for (const folder of folders) {
        const files = await listFilesAsync(folder);
        const file = preferredFile != null && files.includes(preferredFile) ? preferredFile : pickLicenseFile(files);

        if (file != null) {
            return await readTextAsync(join(folder, file));
        }
    }

    return null;
}

async function readPartAsync(rootDirectory, directory, part) {
    if (part.path != null) {
        return `${part.title}\n\n${await readTextAsync(join(rootDirectory, directory, part.path))}`;
    }

    const partDirectory = await resolvePackageDirectoryAsync(rootDirectory, directory, part.package);
    const text = partDirectory == null ? null : await readLicenseTextAsync(rootDirectory, partDirectory, null);

    if (text == null) {
        throw new Error(`No licence text for ${part.package}, which ${packageNameOf(directory)} ships inside its own files.`);
    }

    return `${part.title}\n\n${text}`;
}

// One package's notice;
// `text` is null when the package ships no license text and vendor/licenses has none for it.
async function readNoticeAsync(rootDirectory, directory) {
    const name = packageNameOf(directory);
    const rule = PACKAGE_RULES[name] ?? {};
    const manifest = JSON.parse(await readFile(join(rootDirectory, directory, 'package.json'), 'utf-8'));
    const version = manifest.version ?? 'unknown';
    const declared = manifestLicense(manifest);

    if (rule.offered != null && declared !== rule.offered) {
        throw new Error(`${name} ${version} is offered under ${declared}, not ${rule.offered}; check the licence elected for it.`);
    }

    const license = rule.elected ?? declared ?? rule.license ?? null;
    const licenseText = await readLicenseTextAsync(rootDirectory, directory, rule.file ?? null);

    if (licenseText == null) {
        return { name, version, license: license ?? 'unknown', text: null, directory };
    }

    const files = await listFilesAsync(join(rootDirectory, directory));
    const notices = [];

    for (const file of pickNoticeFiles(files)) {
        notices.push(await readTextAsync(join(rootDirectory, directory, file)));
    }

    const parts = [];

    for (const part of rule.parts ?? []) {
        parts.push(await readPartAsync(rootDirectory, directory, part));
    }

    const election = rule.elected == null
        ? null
        : `Nib Studio uses ${name} under ${rule.elected}, one of the licences it is offered under: ${rule.offered}.`;
    const sections = [election, rule.statement?.(version) ?? null, licenseText, ...notices, ...parts];

    return {
        name,
        version,
        license: license ?? 'See the licence text',
        text: sections.filter((section) => section != null).join(SECTION_BREAK),
        directory,
    };
}

// The notices of every package the bundles take code from and of every package whose files are copied,
// sorted.
// Throws when a shipped package has no license text, naming each one.
export async function collectNoticesAsync({ rootDirectory, metafiles, copiedPaths }) {
    const copied = copiedPaths.map((path) => packageDirectoryOf(relative(rootDirectory, path))).filter((directory) => directory != null);
    // A package reached through a linked node_modules folder, as esbuild reports it by its real path,
    // is listed once.
    const directories = new Map();

    for (const directory of [...bundledPackageDirectories(metafiles), ...copied]) {
        const path = join(rootDirectory, directory);
        const realPath = await realpath(path).catch(() => path);

        if (!directories.has(realPath)) {
            directories.set(realPath, directory);
        }
    }

    const notices = [];

    for (const directory of directories.values()) {
        notices.push(await readNoticeAsync(rootDirectory, directory));
    }

    const missing = notices.filter((notice) => notice.text == null);

    if (missing.length > 0) {
        const names = missing.map((notice) => `${notice.name} ${notice.version} (${notice.directory})`).join(', ');

        throw new Error(`No licence text for ${names}. Add it under vendor/licenses/<package name>/.`);
    }

    return notices.sort(compareNotices);
}

// THIRD_PARTY_NOTICES.txt: the list of packages, then each one's license text in full.
export function buildNoticesText(notices) {
    const unit = notices.length === 1 ? 'package' : 'packages';
    const header = [
        'Nib Studio third-party notices',
        '',
        'Nib Studio is licensed under the MIT License.',
        `It ships these ${notices.length} third-party ${unit}, each under its own licence, whose full text follows the list.`,
        '',
        ...notices.map((notice) => `${notice.name} ${notice.version}: ${notice.license}`),
    ];
    const sections = notices.map((notice) => [
        RULE,
        `${notice.name} ${notice.version}`,
        `Licence: ${notice.license}`,
        RULE,
        '',
        notice.text,
    ].join('\n'));

    return `${[header.join('\n'), ...sections].join(SECTION_BREAK)}\n`;
}

function escapeForTemplate(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}

function quote(value) {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

// The vendorLicenses.ts source. A license text two or more packages share is written once, as a constant.
export function buildTypeScriptSource(notices) {
    const uses = new Map();

    for (const notice of notices) {
        uses.set(notice.text, (uses.get(notice.text) ?? 0) + 1);
    }

    const sharedNames = new Map();

    for (const [text, count] of uses) {
        if (count > 1) {
            sharedNames.set(text, `SHARED_TEXT_${sharedNames.size + 1}`);
        }
    }

    const entryLines = (notice) => [
        '    {',
        `        name: ${quote(notice.name)},`,
        `        version: ${quote(notice.version)},`,
        `        license: ${quote(notice.license)},`,
        sharedNames.has(notice.text)
            ? `        text: ${sharedNames.get(notice.text)},`
            : `        text: \`${escapeForTemplate(notice.text)}\`,`,
        '    },',
    ];
    const sharedLines = [...sharedNames].flatMap(([text, name]) => [
        `const ${name} = \`${escapeForTemplate(text)}\`;`,
        '',
    ]);

    return [
        '// Generated by scripts/collect-licenses.mjs — do not edit by hand.',
        '// Every build refreshes it from the packages esbuild bundles and the package files the build copies.',
        '',
        'export interface VendorLicense {',
        '    readonly name: string;',
        '    readonly version: string;',
        '    readonly license: string;',
        '    readonly text: string;',
        '}',
        '',
        ...(sharedLines.length === 0 ? [] : ['// Licence texts more than one package ships, each written once.', ...sharedLines]),
        'export const VENDOR_LICENSES: ReadonlyArray<VendorLicense> = [',
        ...notices.flatMap(entryLines),
        '];',
        '',
    ].join('\n');
}

// Writes src/nib-studio/vendorLicenses.ts, and THIRD_PARTY_NOTICES.txt into the output folder,
// each with every package the build ships; returns how many that is.
export async function writeThirdPartyNoticesAsync({ rootDirectory, metafiles, copiedPaths, outputDirectory }) {
    const notices = await collectNoticesAsync({ rootDirectory, metafiles, copiedPaths });
    const sourcePath = join(rootDirectory, 'src', 'nib-studio', 'vendorLicenses.ts');
    const source = buildTypeScriptSource(notices);
    const current = await readFile(sourcePath, 'utf-8').catch(() => '');

    // Rewriting an unchanged file would retrigger watch builds for nothing.
    if (current !== source) {
        await writeFile(sourcePath, source, 'utf-8');
    }

    await writeFile(join(outputDirectory, NOTICES_FILE_NAME), buildNoticesText(notices), 'utf-8');

    return notices.length;
}
