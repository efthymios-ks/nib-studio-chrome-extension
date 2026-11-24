import exifr from 'exifr';
import { compactGroups, metadataGroup, type MetadataGroup } from '../preview/metadataGroups.js';

// The EXIF tags the Info panel shows, as exifr names them, with values left as they are stored.
export interface ExifTags {
    readonly Make?: unknown;
    readonly Model?: unknown;
    readonly Software?: unknown;
    readonly Orientation?: unknown;
    readonly LensMake?: unknown;
    readonly LensModel?: unknown;
    readonly DateTimeOriginal?: unknown;
    readonly CreateDate?: unknown;
    readonly OffsetTimeOriginal?: unknown;
    readonly ExposureTime?: unknown;
    readonly FNumber?: unknown;
    readonly ISO?: unknown;
    readonly FocalLength?: unknown;
    readonly FocalLengthIn35mmFormat?: unknown;
    readonly Flash?: unknown;
    readonly latitude?: unknown;
    readonly longitude?: unknown;
    readonly GPSAltitude?: unknown;
    readonly GPSAltitudeRef?: unknown;
}

// Only the blocks the panel uses are read; thumbnails, XMP, ICC and maker notes are skipped,
// and values stay raw so dates keep the time the camera wrote rather than moving to this device's time zone.
const EXIF_OPTIONS = {
    tiff: true,
    exif: true,
    gps: true,
    ifd1: false,
    interop: false,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false,
    makerNote: false,
    userComment: false,
    translateKeys: true,
    translateValues: false,
    reviveValues: false,
    mergeOutput: true,
} as const;

// The EXIF of a JPEG, HEIC, AVIF, TIFF or PNG, read in chunks from a Blob; null when there is none or it can't be read.
export async function readExifTagsAsync(input: Blob | Uint8Array): Promise<ExifTags | null> {
    try {
        const tags: unknown = await exifr.parse(input, EXIF_OPTIONS);

        return tags != null && typeof tags === 'object' ? tags as ExifTags : null;
    }
    catch {
        return null;
    }
}

// The Camera and Location groups for the Info panel; orientation goes with the image size, through `formatOrientation`.
export function exifMetadataGroups(tags: ExifTags | null): MetadataGroup[] {
    if (tags == null) {
        return [];
    }

    return compactGroups([
        metadataGroup('Camera', [
            ['Camera', joinMakeAndModel(text(tags.Make), text(tags.Model))],
            ['Lens', joinMakeAndModel(text(tags.LensMake), text(tags.LensModel))],
            ['Date taken', formatExifDate(tags.DateTimeOriginal ?? tags.CreateDate, tags.OffsetTimeOriginal)],
            ['Exposure', formatExposure(tags.ExposureTime)],
            ['Aperture', formatAperture(tags.FNumber)],
            ['ISO', formatIso(tags.ISO)],
            ['Focal length', formatFocalLength(tags.FocalLength, tags.FocalLengthIn35mmFormat)],
            ['Flash', formatFlash(tags.Flash)],
            ['Software', text(tags.Software)],
        ]),
        metadataGroup('Location', [
            ['Coordinates', formatCoordinates(tags.latitude, tags.longitude)],
            ['Altitude', formatAltitude(tags.GPSAltitude, tags.GPSAltitudeRef)],
        ]),
    ]);
}

const ORIENTATIONS: ReadonlyArray<string> = [
    'Normal',
    'Mirrored horizontally',
    'Rotated 180°',
    'Mirrored vertically',
    'Mirrored horizontally, rotated 90° anticlockwise',
    'Rotated 90° clockwise',
    'Mirrored horizontally, rotated 90° clockwise',
    'Rotated 90° anticlockwise',
];

// "Rotated 90° clockwise (EXIF 6)": how the stored pixels are turned for display.
export function formatOrientation(value: unknown): string | null {
    const orientation = firstNumber(value);
    const label = orientation == null ? undefined : ORIENTATIONS[orientation - 1];

    return label == null ? null : `${label} (EXIF ${orientation})`;
}

// "1/250 s" for fractions of a second, "2.5 s" for longer exposures.
export function formatExposure(value: unknown): string | null {
    const seconds = firstNumber(value);

    if (seconds == null || seconds <= 0) {
        return null;
    }

    if (seconds < 1) {
        return `1/${Math.round(1 / seconds)} s`;
    }

    return `${trimNumber(seconds, 1)} s`;
}

export function formatAperture(value: unknown): string | null {
    const fNumber = firstNumber(value);

    return fNumber == null || fNumber <= 0 ? null : `f/${trimNumber(fNumber, 1)}`;
}

export function formatIso(value: unknown): string | null {
    const iso = firstNumber(value);

    return iso == null || iso <= 0 ? null : `ISO ${iso}`;
}

// "4.2 mm (26 mm in 35 mm terms)".
export function formatFocalLength(value: unknown, equivalent: unknown): string | null {
    const millimetres = firstNumber(value);

    if (millimetres == null || millimetres <= 0) {
        return null;
    }

    const fullFrame = firstNumber(equivalent);
    const base = `${trimNumber(millimetres, 2)} mm`;

    return fullFrame == null || fullFrame <= 0 ? base : `${base} (${fullFrame} mm in 35 mm terms)`;
}

const FLASH_MODES: Readonly<Record<number, string>> = Object.freeze({
    1: 'on',
    2: 'off',
    3: 'auto',
});

// The EXIF flash bit field: bit 0 says whether it fired, bits 3 and 4 the mode, bit 5 that there is no flash.
export function formatFlash(value: unknown): string | null {
    const flash = firstNumber(value);

    if (flash == null) {
        return null;
    }

    if ((flash & 0x20) !== 0) {
        return 'No flash';
    }

    const fired = (flash & 0x01) !== 0 ? 'Fired' : 'Did not fire';
    const mode = FLASH_MODES[(flash >> 3) & 0x03];

    return mode == null ? fired : `${fired} (${mode})`;
}

// "2024-06-15 18:42:07 +02:00" from the EXIF form "2024:06:15 18:42:07" and its offset, when the camera wrote one.
export function formatExifDate(value: unknown, offset: unknown): string | null {
    const raw = text(value);
    const match = raw == null ? null : /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);

    if (match == null) {
        return raw;
    }

    const [, year, month, day, hour, minute, second] = match;
    const zone = text(offset);
    // An offset reads like the other dates' in the Info panel, such as UTC+02:00.
    const shownZone = zone != null && /^[+-]\d{2}:\d{2}$/.test(zone) ? `UTC${zone}` : zone;

    return `${year}-${month}-${day} ${hour}:${minute}:${second ?? '00'}${shownZone == null ? '' : ` ${shownZone}`}`;
}

// "48.858222° N, 2.294500° E", plain text with no map link.
export function formatCoordinates(latitude: unknown, longitude: unknown): string | null {
    const north = firstNumber(latitude);
    const east = firstNumber(longitude);

    if (north == null || east == null) {
        return null;
    }

    return `${formatCoordinate(north, 'N', 'S')}, ${formatCoordinate(east, 'E', 'W')}`;
}

// "48.858222° N": one coordinate in degrees, with the hemisphere its sign stands for.
function formatCoordinate(degrees: number, positive: string, negative: string): string {
    return `${Math.abs(degrees).toFixed(6)}° ${degrees < 0 ? negative : positive}`;
}

// "35 m above sea level"; reference 1 means below.
export function formatAltitude(value: unknown, reference: unknown): string | null {
    const metres = firstNumber(value);

    if (metres == null) {
        return null;
    }

    const isBelow = firstNumber(reference) === 1;

    return `${trimNumber(metres, 1)} m ${isBelow ? 'below' : 'above'} sea level`;
}

// Joins a maker and model without saying the maker twice, as in "Canon" + "Canon EOS R5".
function joinMakeAndModel(make: string | null, model: string | null): string | null {
    if (model == null) {
        return make;
    }

    if (make == null || model.toLowerCase().startsWith(make.toLowerCase())) {
        return model;
    }

    return `${make} ${model}`;
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.replace(/\0+$/, '').trim();

    return trimmed === '' ? null : trimmed;
}

// A number from a tag that may hold one value, an array or a typed array.
function firstNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        return firstNumber((value as ArrayLike<unknown>)[0]);
    }

    return null;
}

function trimNumber(value: number, decimals: number): string {
    return String(Number(value.toFixed(decimals)));
}
