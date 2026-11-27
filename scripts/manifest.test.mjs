import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT_DIRECTORY, 'public', 'manifest.json'), 'utf-8'));
const SANDBOX_PAGE = 'nib-studio/sandbox.html';
const SANDBOX_TOKENS = ['allow-scripts', 'allow-modals', 'allow-forms'];

// The text of a string constant in a source file, such as the flags the HTML preview's frame asks for.
function constantOf(path, name) {
    const source = readFileSync(join(ROOT_DIRECTORY, ...path.split('/')), 'utf-8');
    const match = new RegExp(`^(?:export )?const ${name} = '([^']*)';`, 'm').exec(source);

    return match?.[1] ?? null;
}

// A policy as a map of directive to its sources, in the order written.
function directivesOf(policy) {
    const directives = new Map();

    for (const part of policy.split(';')) {
        const [name, ...sources] = part.trim().split(/\s+/);

        if (name != null && name !== '') {
            directives.set(name, sources);
        }
    }

    return directives;
}

// Any source that would let a page reach a network: a scheme of the web, a host, or a wildcard.
function isRemoteSource(source) {
    return /^(https?|wss?|ftp):/i.test(source) || source.includes('*') || /^[a-z0-9-]+\.[a-z]/i.test(source) || source.startsWith('//');
}

describe('manifest.json', () => {
    it('declares the HTML preview\'s sandbox page', () => {
        expect(MANIFEST.sandbox).toEqual({ pages: [SANDBOX_PAGE] });
    });

    it('sandboxes the page with scripts, dialogs and forms only: no same origin, popups or navigation of the studio', () => {
        const sandbox = directivesOf(MANIFEST.content_security_policy.sandbox).get('sandbox');

        expect(sandbox).toEqual(SANDBOX_TOKENS);
    });

    it('has the preview\'s frame ask for the same sandbox flags as the policy', () => {
        expect(constantOf('src/nib-studio/views/htmlPreview.ts', 'SANDBOX_FLAGS')?.split(' ')).toEqual(SANDBOX_TOKENS);
    });

    it('gives the sandbox page no network: it connects only to data: and blob: URLs, and every source is the page itself or inline', () => {
        const directives = directivesOf(MANIFEST.content_security_policy.sandbox);

        expect(directives.get('default-src')).toEqual(["'none'"]);
        expect(directives.get('connect-src')).toEqual(['data:', 'blob:']);
        expect(directives.get('form-action')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'none'"]);
        expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'data:']);

        for (const name of ['style-src', 'img-src', 'font-src', 'media-src']) {
            expect(directives.get(name)?.every((source) => ["'unsafe-inline'", 'data:', 'blob:'].includes(source))).toBe(true);
        }

        for (const [name, sources] of directives) {
            expect(sources.filter(isRemoteSource), name).toEqual([]);
        }
    });

    it('names no web scheme, WebSocket or host as a source, in any directive of the sandbox page', () => {
        const sources = [...directivesOf(MANIFEST.content_security_policy.sandbox)]
            .filter(([name]) => name !== 'sandbox' && name !== 'trusted-types' && name !== 'require-trusted-types-for')
            .flatMap(([, list]) => list);
        const remote = ['http:', 'https:', 'ws:', 'wss:', 'ftp:', '*', 'https://example.com', 'wss://example.com', 'example.com'];

        expect(sources.filter((source) => remote.includes(source) || isRemoteSource(source))).toEqual([]);
        expect(remote.every(isRemoteSource)).toBe(true);
        expect(['data:', 'blob:', "'self'", "'none'", "'unsafe-inline'"].some(isRemoteSource)).toBe(false);
    });

    it('lets the page make no frame or worker, since WebRTC, which no policy governs, would come back in one', () => {
        const directives = directivesOf(MANIFEST.content_security_policy.sandbox);

        expect(directives.get('frame-src')).toEqual(["'none'"]);
        expect(directives.get('child-src')).toEqual(["'none'"]);
        expect(directives.get('worker-src')).toEqual(["'none'"]);
    });

    it('hands every srcdoc and piece of markup to the sandbox page\'s own policies, and lets the page make none', () => {
        const directives = directivesOf(MANIFEST.content_security_policy.sandbox);

        expect(directives.get('require-trusted-types-for')).toEqual(["'script'"]);
        expect(directives.get('trusted-types')).toEqual(['default', constantOf('src/nib-studio/sandboxGuard.ts', 'PAGE_POLICY')]);
    });

    it('keeps the studio\'s own pages offline, with frames only from the extension', () => {
        const directives = directivesOf(MANIFEST.content_security_policy.extension_pages);

        expect(directives.get('script-src')).toEqual(["'self'"]);
        expect(directives.get('connect-src')).toEqual(["'self'"]);
        expect(directives.get('frame-src')).toEqual(["'self'"]);

        for (const [name, sources] of directives) {
            expect(sources.filter(isRemoteSource), name).toEqual([]);
        }
    });
});

describe('the sandbox page in the build and the package', () => {
    it('builds the sandbox page and its script, and packages both', () => {
        const build = readFileSync(join(ROOT_DIRECTORY, 'scripts', 'build.mjs'), 'utf-8');
        const publish = readFileSync(join(ROOT_DIRECTORY, 'Publish-Extension.ps1'), 'utf-8');
        const page = readFileSync(join(ROOT_DIRECTORY, 'src', SANDBOX_PAGE), 'utf-8');

        expect(build).toContain("join(ROOT_DIRECTORY, 'src', 'nib-studio', 'sandbox.html')");
        expect(build).toContain("out: 'nib-studio/sandbox'");
        expect(publish).toContain("'nib-studio/sandbox.html'");
        expect(publish).toContain("'nib-studio/sandbox.js'");
        expect(page).toContain('<script src="sandbox.js"></script>');
    });
});
