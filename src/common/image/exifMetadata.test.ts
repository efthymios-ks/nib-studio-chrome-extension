import { describe, expect, it } from 'vitest';
import { buildExifJpeg, buildTiff, buildWebp, samplePhotoExif } from './testing/imageBuilders.js';
import {
    exifMetadataGroups,
    formatAltitude,
    formatAperture,
    formatCoordinates,
    formatExifDate,
    formatExposure,
    formatFlash,
    formatFocalLength,
    formatIso,
    formatOrientation,
    readExifTagsAsync,
} from './exifMetadata.js';

describe('readExifTagsAsync', () => {
    it('reads camera, capture and GPS tags from a JPEG, with dates as written', async () => {
        const tags = await readExifTagsAsync(buildExifJpeg(samplePhotoExif()));

        expect(tags?.Make).toBe('Nib Camera Co.');
        expect(tags?.Model).toBe('Sample X1');
        expect(tags?.Orientation).toBe(6);
        expect(tags?.DateTimeOriginal).toBe('2024:06:15 18:42:07');
        expect(tags?.ExposureTime).toBe(0.004);
        expect(tags?.latitude).toBeCloseTo(-33.859, 3);
        expect(tags?.longitude).toBeCloseTo(-70.5, 3);
    });

    it('reads the tags of a TIFF', async () => {
        const tiff = buildTiff([{ width: 1, height: 1, rgb: [0, 0, 0], extra: [{ tag: 0x010f, type: 2, value: 'Nib Scanner Co.' }] }]);
        const tags = await readExifTagsAsync(tiff);

        expect(tags?.Make).toBe('Nib Scanner Co.');
    });

    it('gives null for an image without EXIF and for bytes that are no image', async () => {
        expect(await readExifTagsAsync(buildWebp(1))).toBeNull();
        expect(await readExifTagsAsync(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    });
});

describe('exifMetadataGroups', () => {
    it('groups the fixture tags into Camera and Location rows', async () => {
        const groups = exifMetadataGroups(await readExifTagsAsync(buildExifJpeg(samplePhotoExif())));

        expect(groups).toEqual([
            {
                title: 'Camera',
                rows: [
                    { label: 'Camera', value: 'Nib Camera Co. Sample X1' },
                    { label: 'Lens', value: 'Sample 4.2mm f/1.8' },
                    { label: 'Date taken', value: '2024-06-15 18:42:07 UTC+02:00' },
                    { label: 'Exposure', value: '1/250 s' },
                    { label: 'Aperture', value: 'f/1.8' },
                    { label: 'ISO', value: 'ISO 100' },
                    { label: 'Focal length', value: '4.2 mm (26 mm in 35 mm terms)' },
                    { label: 'Flash', value: 'Fired (auto)' },
                    { label: 'Software', value: 'Nib Studio sample generator' },
                ],
            },
            {
                title: 'Location',
                rows: [
                    { label: 'Coordinates', value: '33.859000° S, 70.500000° W' },
                    { label: 'Altitude', value: '12 m below sea level' },
                ],
            },
        ]);
    });

    it('leaves out groups with no tags, and never says the maker twice', () => {
        expect(exifMetadataGroups(null)).toEqual([]);
        expect(exifMetadataGroups({ Make: 'Canon', Model: 'Canon EOS R5' })[0]?.rows).toEqual([{ label: 'Camera', value: 'Canon EOS R5' }]);
        expect(exifMetadataGroups({ Make: 'Apple', Model: 'iPhone 7' })).toEqual([
            { title: 'Camera', rows: [{ label: 'Camera', value: 'Apple iPhone 7' }] },
        ]);
    });
});

describe('EXIF value formats', () => {
    it('writes exposures as fractions or seconds', () => {
        expect(formatExposure(0.01)).toBe('1/100 s');
        expect(formatExposure(1 / 3)).toBe('1/3 s');
        expect(formatExposure(2.5)).toBe('2.5 s');
        expect(formatExposure(0)).toBeNull();
        expect(formatExposure('fast')).toBeNull();
    });

    it('writes apertures, ISO and focal lengths', () => {
        expect(formatAperture(2.8)).toBe('f/2.8');
        expect(formatIso([200, 0])).toBe('ISO 200');
        expect(formatFocalLength(3.99, undefined)).toBe('3.99 mm');
        expect(formatFocalLength(50, 50)).toBe('50 mm (50 mm in 35 mm terms)');
    });

    it('describes the flash bit field', () => {
        expect(formatFlash(0)).toBe('Did not fire');
        expect(formatFlash(16)).toBe('Did not fire (off)');
        expect(formatFlash(9)).toBe('Fired (on)');
        expect(formatFlash(24)).toBe('Did not fire (auto)');
        expect(formatFlash(32)).toBe('No flash');
    });

    it('names every orientation', () => {
        expect(formatOrientation(1)).toBe('Normal (EXIF 1)');
        expect(formatOrientation(6)).toBe('Rotated 90° clockwise (EXIF 6)');
        expect(formatOrientation(8)).toBe('Rotated 90° anticlockwise (EXIF 8)');
        expect(formatOrientation(9)).toBeNull();
    });

    it('keeps the date as written, adding the offset when there is one', () => {
        expect(formatExifDate('2019:10:20 18:34:30', '+02:00')).toBe('2019-10-20 18:34:30 UTC+02:00');
        expect(formatExifDate('2019:10:20 18:34', undefined)).toBe('2019-10-20 18:34:00');
        expect(formatExifDate('sometime', undefined)).toBe('sometime');
        expect(formatExifDate(undefined, '+02:00')).toBeNull();
    });

    it('writes coordinates and altitude as plain text', () => {
        expect(formatCoordinates(48.858222, 2.2945)).toBe('48.858222° N, 2.294500° E');
        expect(formatCoordinates(48.8, undefined)).toBeNull();
        expect(formatAltitude(35, new Uint8Array([0]))).toBe('35 m above sea level');
        expect(formatAltitude(4.25, 1)).toBe('4.3 m below sea level');
    });
});
