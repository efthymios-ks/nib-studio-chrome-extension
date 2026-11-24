import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildNoticesText,
    buildTypeScriptSource,
    bundledPackageDirectories,
    collectNoticesAsync,
    compareNotices,
    manifestLicense,
    packageDirectoryOf,
    pickLicenseFile,
    pickNoticeFiles,
    writeThirdPartyNoticesAsync,
} from './collect-licenses.mjs';

const MIT_TEXT = 'MIT License\n\nCopyright (c) Example\n\nPermission is hereby granted, free of charge.';
const APACHE_TEXT = '                                 Apache License\n                           Version 2.0, January 2004';

// A metafile as esbuild writes it on Windows: inputs relative to the working folder, with backslashes.
const FAKE_METAFILE = {
    inputs: {
        'src\\nib-studio\\main.ts': { bytes: 100 },
        'node_modules\\@codemirror\\view\\dist\\index.js': { bytes: 10 },
        'node_modules\\@codemirror\\view\\dist\\extra.js': { bytes: 10 },
        'node_modules\\mermaid\\dist\\mermaid.core.mjs': { bytes: 10 },
        'node_modules\\mermaid\\node_modules\\dompurify\\dist\\purify.es.mjs': { bytes: 10 },
        'node_modules\\dompurify\\dist\\purify.es.mjs': { bytes: 10 },
    },
};
const WORKER_METAFILE = {
    inputs: {
        'node_modules/utif2/UTIF.js': { bytes: 10 },
        'src/nib-studio/imageDecodeWorker.ts': { bytes: 10 },
    },
};

let root = '';

async function writeFileAsync(path, text) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf-8');
}

async function writePackageAsync(directory, manifest, files = {}) {
    await writeFileAsync(`${directory}/package.json`, JSON.stringify(manifest));

    for (const [name, text] of Object.entries(files)) {
        await writeFileAsync(`${directory}/${name}`, text);
    }
}

function notice(name, version, license = 'MIT', text = MIT_TEXT) {
    return { name, version, license, text };
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nib-notices-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('packageDirectoryOf', () => {
    it('finds the package folder of a bundled file, scoped and nested packages included', () => {
        expect(packageDirectoryOf('node_modules\\pako\\lib\\inflate.js')).toBe('node_modules/pako');
        expect(packageDirectoryOf('node_modules/@codemirror/view/dist/index.js')).toBe('node_modules/@codemirror/view');
        expect(packageDirectoryOf('node_modules/mermaid/node_modules/dompurify/dist/purify.es.mjs'))
            .toBe('node_modules/mermaid/node_modules/dompurify');
    });

    it('is null for a file of the extension itself', () => {
        expect(packageDirectoryOf('src/nib-studio/main.ts')).toBeNull();
        expect(packageDirectoryOf('node_modules/')).toBeNull();
    });
});

describe('bundledPackageDirectories', () => {
    it('lists each package the metafiles take code from once, sorted, with a nested copy as a package of its own', () => {
        expect(bundledPackageDirectories([FAKE_METAFILE, WORKER_METAFILE])).toEqual([
            'node_modules/@codemirror/view',
            'node_modules/dompurify',
            'node_modules/mermaid',
            'node_modules/mermaid/node_modules/dompurify',
            'node_modules/utif2',
        ]);
    });

    it('lists nothing for a bundle of the extension\'s own code', () => {
        expect(bundledPackageDirectories([{ inputs: { 'src/background/main.ts': { bytes: 1 } } }])).toEqual([]);
    });
});

describe('pickLicenseFile and pickNoticeFiles', () => {
    it('takes the shortest license file name, in any spelling and case', () => {
        expect(pickLicenseFile(['README.md', 'LICENSE-MPL', 'LICENSE'])).toBe('LICENSE');
        expect(pickLicenseFile(['LICENSE.markdown', 'index.js'])).toBe('LICENSE.markdown');
        expect(pickLicenseFile(['LICENCE'])).toBe('LICENCE');
        expect(pickLicenseFile(['license'])).toBe('license');
        expect(pickLicenseFile(['LICENSE-MIT.txt'])).toBe('LICENSE-MIT.txt');
        expect(pickLicenseFile(['COPYING'])).toBe('COPYING');
    });

    it('skips a script named after the license and finds none in a package without one', () => {
        expect(pickLicenseFile(['LICENSE', 'license-update.mjs'])).toBe('LICENSE');
        expect(pickLicenseFile(['license-update.mjs', 'package.json'])).toBeNull();
    });

    it('finds NOTICE files', () => {
        expect(pickNoticeFiles(['LICENSE', 'NOTICE', 'NOTICE.txt', 'notice.js'])).toEqual(['NOTICE', 'NOTICE.txt']);
    });
});

describe('manifestLicense and compareNotices', () => {
    it('reads the license string, an old license object or a licenses list, and null without any', () => {
        expect(manifestLicense({ license: 'ISC' })).toBe('ISC');
        expect(manifestLicense({ license: { type: 'MIT' } })).toBe('MIT');
        expect(manifestLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
        expect(manifestLicense({})).toBeNull();
    });

    it('sorts by name, then by version in number order', () => {
        const sorted = [notice('dompurify', '3.4.18'), notice('@lezer/lr', '1.0.0'), notice('dompurify', '3.4.7')].sort(compareNotices);

        expect(sorted.map((entry) => `${entry.name} ${entry.version}`)).toEqual(['@lezer/lr 1.0.0', 'dompurify 3.4.7', 'dompurify 3.4.18']);
    });
});

describe('collectNoticesAsync', () => {
    it('reads each package\'s version, license and license text, with NOTICE files and copied packages added', async () => {
        await writePackageAsync('node_modules/@codemirror/view', { version: '6.1.0', license: 'MIT' }, { LICENSE: MIT_TEXT });
        await writePackageAsync('node_modules/mermaid', { version: '12.0.0', license: 'MIT' }, { LICENSE: MIT_TEXT });
        await writePackageAsync('node_modules/utif2', { version: '4.1.0', license: 'MIT' }, { 'LICENSE.txt': `${MIT_TEXT}\r\n` });
        await writePackageAsync('node_modules/dompurify', { version: '3.4.7', license: '(MPL-2.0 OR Apache-2.0)' }, { LICENSE: APACHE_TEXT });
        await writePackageAsync(
            'node_modules/mermaid/node_modules/dompurify',
            { version: '3.4.18', license: '(MPL-2.0 OR Apache-2.0)' },
            { 'LICENSE': APACHE_TEXT, 'LICENSE-MPL': 'Mozilla Public License Version 2.0' },
        );
        await writePackageAsync('node_modules/es-toolkit', { version: '1.0.0', license: 'MIT' }, { LICENSE: MIT_TEXT, NOTICE: 'Parts derive from Lodash.' });

        const notices = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [FAKE_METAFILE, WORKER_METAFILE],
            copiedPaths: [join(root, 'node_modules', 'es-toolkit', 'dist', 'index.js'), join(root, 'public')],
        });

        expect(notices.map((entry) => `${entry.name} ${entry.version} ${entry.license}`)).toEqual([
            '@codemirror/view 6.1.0 MIT',
            'dompurify 3.4.7 Apache-2.0',
            'dompurify 3.4.18 Apache-2.0',
            'es-toolkit 1.0.0 MIT',
            'mermaid 12.0.0 MIT',
            'utif2 4.1.0 MIT',
        ]);
        expect(notices.find((entry) => entry.name === 'utif2')?.text).toBe(MIT_TEXT);
        expect(notices.find((entry) => entry.name === 'es-toolkit')?.text).toBe(`${MIT_TEXT}\n\n\nParts derive from Lodash.`);
    });

    it('lists a package once when the bundle reaches it through a linked node_modules folder', async () => {
        await writePackageAsync('node_modules/utif2', { version: '4.1.0', license: 'MIT' }, { LICENSE: MIT_TEXT });
        await mkdir(join(root, 'linked'), { recursive: true });
        await symlink(join(root, 'node_modules'), join(root, 'linked', 'node_modules'), 'junction');

        const notices = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'linked/node_modules/utif2/UTIF.js': { bytes: 1 } } }],
            copiedPaths: [join(root, 'node_modules', 'utif2', 'UTIF.js')],
        });

        expect(notices.map((entry) => entry.name)).toEqual(['utif2']);
    });

    it('records the license elected for a dual-licensed package, with its elected text only', async () => {
        await writePackageAsync(
            'node_modules/dompurify',
            { version: '3.4.18', license: '(MPL-2.0 OR Apache-2.0)' },
            { 'LICENSE': APACHE_TEXT, 'LICENSE-MPL': 'Mozilla Public License Version 2.0' },
        );

        const [dompurify] = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/dompurify/dist/purify.es.mjs': { bytes: 1 } } }],
            copiedPaths: [],
        });

        expect(dompurify?.license).toBe('Apache-2.0');
        expect(dompurify?.text).toContain('Nib Studio uses dompurify under Apache-2.0, one of the licences it is offered under: (MPL-2.0 OR Apache-2.0).');
        expect(dompurify?.text).toContain('Apache License');
        expect(dompurify?.text).not.toContain('Mozilla');
    });

    it('adds the source statement of elkjs, with its exact version', async () => {
        await writePackageAsync('node_modules/elkjs', { version: '0.12.1', license: 'EPL-2.0 OR GPL-3.0-or-later' }, {
            'LICENSE.md': '# Eclipse Public License - v 2.0',
        });

        const [elkjs] = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/elkjs/lib/elk.bundled.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        expect(elkjs?.license).toBe('EPL-2.0');
        expect(elkjs?.text).toContain('Eclipse Public License - v 2.0');
        expect(elkjs?.text).toContain('https://www.npmjs.com/package/elkjs/v/0.12.1');
        expect(elkjs?.text).toContain('https://github.com/kieler/elkjs');
    });

    it('adds the licenses of the packages jszip inlines in its prebuilt file', async () => {
        await writePackageAsync('node_modules/jszip', { version: '3.10.2', license: '(MIT OR GPL-3.0-or-later)' }, {
            'LICENSE.markdown': 'JSZip is dual licensed.',
        });

        for (const name of ['pako', 'lie', 'immediate', 'setimmediate']) {
            await writePackageAsync(`node_modules/${name}`, { version: '1.0.0', license: 'MIT' }, { LICENSE: `${name} license` });
        }

        const [jszip] = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/jszip/dist/jszip.min.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        expect(jszip?.license).toBe('MIT');

        for (const name of ['pako', 'lie', 'immediate', 'setimmediate']) {
            expect(jszip?.text).toContain(`${name}, inlined in jszip's prebuilt file\n\n${name} license`);
        }
    });

    it('names the license of a package whose package.json has none, such as khroma', async () => {
        await writePackageAsync('node_modules/khroma', { version: '2.1.0' }, { license: MIT_TEXT });

        const [khroma] = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/khroma/dist/khroma.es.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        expect(khroma?.license).toBe('MIT');
        expect(khroma?.text).toBe(MIT_TEXT);
    });

    it('takes the text of a package without a license file from vendor/licenses', async () => {
        await writePackageAsync('node_modules/brotli', { version: '1.3.3', license: 'MIT' });
        await writeFileAsync('vendor/licenses/brotli/LICENSE', 'Brotli license');

        const [brotli] = await collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/brotli/decompress.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        expect(brotli?.text).toBe('Brotli license');
    });

    it('fails, naming every package that ships without license text', async () => {
        await writePackageAsync('node_modules/first', { version: '1.0.0', license: 'MIT' });
        await writePackageAsync('node_modules/second', { version: '2.0.0', license: 'MIT' }, { 'README.md': 'No license here.' });

        const collecting = collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/first/index.js': { bytes: 1 }, 'node_modules/second/index.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        await expect(collecting).rejects.toThrow(/first 1\.0\.0 .*second 2\.0\.0/);
    });

    it('fails when a dual-licensed package changes the licenses it is offered under', async () => {
        await writePackageAsync('node_modules/jszip', { version: '4.0.0', license: 'GPL-3.0-only' }, { LICENSE: 'GPL' });

        const collecting = collectNoticesAsync({
            rootDirectory: root,
            metafiles: [{ inputs: { 'node_modules/jszip/index.js': { bytes: 1 } } }],
            copiedPaths: [],
        });

        await expect(collecting).rejects.toThrow(/jszip 4\.0\.0 is offered under GPL-3\.0-only/);
    });
});

describe('buildNoticesText', () => {
    it('lists every package with its version and license, then each license text in full', () => {
        const text = buildNoticesText([notice('dompurify', '3.4.7', 'Apache-2.0', APACHE_TEXT), notice('utif2', '4.1.0')]);

        expect(text).toContain('It ships these 2 third-party packages');
        expect(text).toContain('dompurify 3.4.7: Apache-2.0\nutif2 4.1.0: MIT\n');
        expect(text).toContain(`dompurify 3.4.7\nLicence: Apache-2.0\n${'='.repeat(80)}\n\n${APACHE_TEXT}`);
        expect(text.endsWith(`${MIT_TEXT}\n`)).toBe(true);
    });
});

describe('buildTypeScriptSource', () => {
    it('writes a text two packages share once, and escapes what a template literal would read', () => {
        const source = buildTypeScriptSource([
            notice('d3-array', '3.2.5', 'ISC', 'ISC text'),
            notice('d3-axis', '3.0.1', 'ISC', 'ISC text'),
            notice('odd', '1.0.0', 'MIT', 'Uses `ticks`, ${braces} and a \\ backslash.'),
        ]);

        expect(source.match(/ISC text/g)).toHaveLength(1);
        expect(source).toContain('const SHARED_TEXT_1 = `ISC text`;');
        expect(source.match(/text: SHARED_TEXT_1,/g)).toHaveLength(2);
        expect(source).toContain('text: `Uses \\`ticks\\`, \\${braces} and a \\\\ backslash.`,');
    });

    it('lists every package in order, each with its own entry', () => {
        const source = buildTypeScriptSource([notice('exifr', '7.1.3'), notice('pdfjs-dist', '6.5.438', 'Apache-2.0', APACHE_TEXT), notice('utif2', '4.1.0')]);
        const list = source.slice(source.indexOf('export const VENDOR_LICENSES'));

        expect(list.indexOf('exifr')).toBeLessThan(list.indexOf('pdfjs-dist'));
        expect(list.indexOf('pdfjs-dist')).toBeLessThan(list.indexOf('utif2'));
        expect(list.match(/^ {4}\{$/gm)).toHaveLength(3);
    });
});

describe('writeThirdPartyNoticesAsync', () => {
    it('writes vendorLicenses.ts and THIRD_PARTY_NOTICES.txt with every package the build ships', async () => {
        await writePackageAsync('node_modules/utif2', { version: '4.1.0', license: 'MIT' }, { LICENSE: MIT_TEXT });
        await writePackageAsync('node_modules/pdfjs-dist', { version: '6.5.438', license: 'Apache-2.0' }, {
            'LICENSE': APACHE_TEXT,
            'wasm/LICENSE_JBIG2': 'JBIG2 licence',
            'wasm/LICENSE_PDFJS_JBIG2': 'JBIG2 build licence',
            'wasm/LICENSE_OPENJPEG': 'OpenJPEG licence',
            'wasm/LICENSE_PDFJS_OPENJPEG': 'OpenJPEG build licence',
            'standard_fonts/LICENSE_FOXIT': 'Foxit licence',
            'cmaps/LICENSE': 'CMaps licence',
        });
        await mkdir(join(root, 'src', 'nib-studio'), { recursive: true });
        await mkdir(join(root, 'dist'), { recursive: true });

        const count = await writeThirdPartyNoticesAsync({
            rootDirectory: root,
            metafiles: [WORKER_METAFILE],
            copiedPaths: [join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs')],
            outputDirectory: join(root, 'dist'),
        });
        const source = await readFile(join(root, 'src', 'nib-studio', 'vendorLicenses.ts'), 'utf-8');
        const text = await readFile(join(root, 'dist', 'THIRD_PARTY_NOTICES.txt'), 'utf-8');

        expect(count).toBe(2);
        expect(source).toContain('name: \'pdfjs-dist\',');
        expect(source).toContain('name: \'utif2\',');
        expect(source).toContain('JBIG2 decoder (PDFium)');
        expect(text).toContain('It ships these 2 third-party packages');
        expect(text).toContain('pdfjs-dist 6.5.438: Apache-2.0\nutif2 4.1.0: MIT\n');
    });
});
