import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage.js';

describe('errorMessage', () => {
    it('reads the message of an Error', () => {
        expect(errorMessage(new Error('Disk full.'))).toBe('Disk full.');
        expect(errorMessage(new TypeError('Not a number.'), 'Save failed.')).toBe('Not a number.');
    });

    it('reads an empty message as it is, not as the fallback', () => {
        expect(errorMessage(new Error(''), 'Save failed.')).toBe('');
    });

    it('reads a thrown value that is no Error as text', () => {
        expect(errorMessage('Gone')).toBe('Gone');
        expect(errorMessage(42)).toBe('42');
        expect(errorMessage(undefined)).toBe('undefined');
        expect(errorMessage(null)).toBe('null');
    });

    it('gives the fallback for a thrown value that is no Error', () => {
        expect(errorMessage('Gone', 'Save failed.')).toBe('Save failed.');
        expect(errorMessage(undefined, 'Copy failed.')).toBe('Copy failed.');
        expect(errorMessage({ message: 'Not an Error' }, '')).toBe('');
    });

    it('reads a DOMException by its message', () => {
        expect(errorMessage(new DOMException('The user aborted a request.', 'AbortError'))).toBe('The user aborted a request.');
    });
});
