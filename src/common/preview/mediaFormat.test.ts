import { describe, expect, it } from 'vitest';
import { mediaTypeLabel } from './mediaFormat.js';

describe('mediaTypeLabel', () => {
    it('names audio and video files by their extension', () => {
        expect(mediaTypeLabel('song.MP3', 'Audio')).toBe('MP3 audio');
        expect(mediaTypeLabel('voice.opus', 'Audio')).toBe('Opus audio');
        expect(mediaTypeLabel('clip.mov', 'Video')).toBe('QuickTime video');
        expect(mediaTypeLabel('clip.mkv', 'Video')).toBe('Matroska video');
    });

    it('falls back for anything else', () => {
        expect(mediaTypeLabel('sound', 'Audio')).toBe('Audio');
    });
});
