import { describe, expect, it } from 'vitest';
import { readSandboxMessage, readStudioMessage, SANDBOX_CHANNEL } from './sandboxMessages.js';

describe('readStudioMessage', () => {
    it('reads a render message, keeping only its known fields', () => {
        const message = readStudioMessage({
            channel: SANDBOX_CHANNEL,
            type: 'render',
            html: '<p>Hi</p>',
            scroll: { left: 0, top: 120, extra: true },
            fragment: null,
            isSmooth: true,
            extra: 'dropped',
        });

        expect(message).toEqual({
            channel: SANDBOX_CHANNEL,
            type: 'render',
            html: '<p>Hi</p>',
            scroll: { left: 0, top: 120 },
            fragment: null,
            isSmooth: true,
        });
    });

    it('reads a reveal message', () => {
        expect(readStudioMessage({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'setup', isSmooth: false }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'setup', isSmooth: false });
    });

    it('reads the answer to a copy, done or refused with a reason', () => {
        expect(readStudioMessage({ channel: SANDBOX_CHANNEL, type: 'copied', id: 3, error: null, text: 'dropped' }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'copied', id: 3, error: null });
        expect(readStudioMessage({ channel: SANDBOX_CHANNEL, type: 'copied', id: 4, error: 'Document is not focused.' }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'copied', id: 4, error: 'Document is not focused.' });
    });

    it('refuses anything else: other channels, unknown types, missing or wrong fields, and non-objects', () => {
        const refused: unknown[] = [
            null,
            'render',
            42,
            [SANDBOX_CHANNEL, 'render'],
            { type: 'render', html: '', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true },
            { channel: 'other', type: 'render', html: '', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'link', href: 'a.md' },
            { channel: SANDBOX_CHANNEL, type: 'toString' },
            { channel: SANDBOX_CHANNEL, type: 'render', html: 1, scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'render', html: '', scroll: { left: 0 }, fragment: null, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'render', html: '', scroll: { left: 0, top: Number.NaN }, fragment: null, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'render', html: '', scroll: { left: 0, top: 0 }, fragment: 3, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'render', html: '', scroll: { left: 0, top: 0 }, fragment: null },
            { channel: SANDBOX_CHANNEL, type: 'reveal', fragment: null, isSmooth: true },
            { channel: SANDBOX_CHANNEL, type: 'copied', id: 1 },
            { channel: SANDBOX_CHANNEL, type: 'copied', id: '1', error: null },
            { channel: SANDBOX_CHANNEL, type: 'copied', id: 1.5, error: null },
            { channel: SANDBOX_CHANNEL, type: 'copied', id: 1, error: { message: 'no' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/plain': 'a' } },
        ];

        for (const data of refused) {
            expect(readStudioMessage(data)).toBeNull();
        }
    });
});

describe('readSandboxMessage', () => {
    it('reads each message the sandbox page posts, keeping only its known fields', () => {
        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'ready', html: '<script>' })).toEqual({ channel: SANDBOX_CHANNEL, type: 'ready' });
        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'rendered' })).toEqual({ channel: SANDBOX_CHANNEL, type: 'rendered' });
        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'save' })).toEqual({ channel: SANDBOX_CHANNEL, type: 'save' });
        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'link', href: '../data/users.csv', target: '_top' }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'link', href: '../data/users.csv' });
        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'scroll', left: 4, top: 300 }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'scroll', left: 4, top: 300 });
    });

    it('reads a copy\'s text, HTML and PNG picture, and whether a click or key press was behind it, dropping other types', () => {
        const picture = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

        expect(readSandboxMessage({ channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/plain': 'flowchart LR' } }))
            .toEqual({ channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/plain': 'flowchart LR' } });
        expect(readSandboxMessage({
            channel: SANDBOX_CHANNEL,
            type: 'copy',
            id: 2,
            isActive: false,
            content: { 'text/plain': 'Hi', 'text/html': '<b>Hi</b>', 'image/png': picture, 'text/uri-list': 'https://example.com/' },
        })).toEqual({
            channel: SANDBOX_CHANNEL,
            type: 'copy',
            id: 2,
            isActive: false,
            content: { 'text/plain': 'Hi', 'text/html': '<b>Hi</b>', 'image/png': picture },
        });
    });

    it('refuses anything else: other channels, studio messages, and wrong fields', () => {
        const refused: unknown[] = [
            undefined,
            { channel: 'nib-studio', type: 'ready' },
            { channel: SANDBOX_CHANNEL },
            { channel: SANDBOX_CHANNEL, type: 'render', html: '' },
            { channel: SANDBOX_CHANNEL, type: 'link' },
            { channel: SANDBOX_CHANNEL, type: 'link', href: { toString: () => 'a.md' } },
            { channel: SANDBOX_CHANNEL, type: 'scroll', left: '4', top: 300 },
            { channel: SANDBOX_CHANNEL, type: 'scroll', left: 4, top: Number.POSITIVE_INFINITY },
            { channel: SANDBOX_CHANNEL, type: '__proto__' },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, content: { 'text/plain': 'a' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: 'yes', content: { 'text/plain': 'a' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: Number.NaN, isActive: true, content: { 'text/plain': 'a' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: {} },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/uri-list': 'https://example.com/' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/plain': 7 } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/html': new Blob(['<b>a</b>']) } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'image/png': 'iVBORw0KGgo=' } },
            { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: ['text/plain', 'a'] },
            { channel: SANDBOX_CHANNEL, type: 'copied', id: 1, error: null },
        ];

        for (const data of refused) {
            expect(readSandboxMessage(data)).toBeNull();
        }
    });
});
