import { describe, expect, it } from 'vitest';
import { unsupportedEncryption } from './officeEncryptionTypes.js';

describe('unsupportedEncryption', () => {
    it('describes encryption the preview can\'t open, with its scheme and the reason', () => {
        expect(unsupportedEncryption('Information Rights Management', 'Only Office can open it.')).toEqual({
            kind: 'unsupported',
            scheme: 'Information Rights Management',
            reason: 'Only Office can open it.',
        });
    });
});
