// Pixels a bundled decoder produced: straight RGBA, 4 bytes a pixel, rows top to bottom.
export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray;
}

type SourcePoint = (column: number, row: number, width: number, height: number) => readonly [number, number];

// For each EXIF orientation, where a pixel of the upright image comes from in the stored one, as column and row.
const ORIENTATION_SOURCES: ReadonlyArray<SourcePoint> = [
    (column, row) => [column, row],
    (column, row, width) => [width - 1 - column, row],
    (column, row, width, height) => [width - 1 - column, height - 1 - row],
    (column, row, _width, height) => [column, height - 1 - row],
    (column, row) => [row, column],
    (column, row, _width, height) => [row, height - 1 - column],
    (column, row, width, height) => [width - 1 - row, height - 1 - column],
    (column, row, width) => [width - 1 - row, column],
];

// Turns stored pixels upright for an EXIF orientation from 1 to 8; any other value leaves them as they are.
export function orientPixels(image: DecodedImage, orientation: number): DecodedImage {
    const source = ORIENTATION_SOURCES[orientation - 1];

    if (source == null || orientation === 1) {
        return image;
    }

    const isSwapped = orientation >= 5;
    const width = isSwapped ? image.height : image.width;
    const height = isSwapped ? image.width : image.height;
    // A whole-pixel view needs a 4-byte aligned start, which a slice of a larger buffer may not have.
    const pixels = image.pixels.byteOffset % 4 === 0 ? image.pixels : image.pixels.slice();
    const input = new Uint32Array(pixels.buffer, pixels.byteOffset, image.width * image.height);
    const output = new Uint32Array(width * height);

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const [sourceColumn, sourceRow] = source(column, row, image.width, image.height);
            output[row * width + column] = input[sourceRow * image.width + sourceColumn] ?? 0;
        }
    }

    return { width, height, pixels: new Uint8ClampedArray(output.buffer) };
}
