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
        ];

        for (const data of refused) {
            expect(readSandboxMessage(data)).toBeNull();
        }
    });
});
