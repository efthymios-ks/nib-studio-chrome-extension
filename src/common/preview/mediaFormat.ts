import { extension } from '../fs/fileEntry.js';

const MEDIA_LABELS: ReadonlyMap<string, string> = new Map([
    ['mp3', 'MP3 audio'],
    ['wav', 'WAV audio'],
    ['ogg', 'Ogg audio'],
    ['oga', 'Ogg audio'],
    ['opus', 'Opus audio'],
    ['flac', 'FLAC audio'],
    ['m4a', 'M4A audio'],
    ['aac', 'AAC audio'],
    ['weba', 'WebM audio'],
    ['mp4', 'MP4 video'],
    ['m4v', 'M4V video'],
    ['webm', 'WebM video'],
    ['ogv', 'Ogg video'],
    ['mov', 'QuickTime video'],
    ['mkv', 'Matroska video'],
]);

// "MP3 audio", "QuickTime video": the Type row of an audio or video file's Info panel.
export function mediaTypeLabel(fileName: string, fallback: string): string {
    return MEDIA_LABELS.get(extension(fileName)) ?? fallback;
}
