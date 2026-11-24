// The RC4 stream cipher: a keystream XORed into the data, so the same call encrypts and decrypts.
export class Rc4 {
    private readonly state = new Uint8Array(256);
    private first = 0;
    private second = 0;

    constructor(key: Uint8Array) {
        if (key.length === 0) {
            throw new Error('An RC4 key needs at least one byte.');
        }

        for (let index = 0; index < 256; index += 1) {
            this.state[index] = index;
        }

        let mixed = 0;

        for (let index = 0; index < 256; index += 1) {
            mixed = (mixed + (this.state[index] ?? 0) + (key[index % key.length] ?? 0)) & 0xff;
            this.swap(index, mixed);
        }
    }

    // XORs the next keystream bytes into the bytes, in place.
    apply(bytes: Uint8Array): Uint8Array {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = (bytes[index] ?? 0) ^ this.nextByte();
        }

        return bytes;
    }

    private nextByte(): number {
        this.first = (this.first + 1) & 0xff;
        this.second = (this.second + (this.state[this.first] ?? 0)) & 0xff;
        this.swap(this.first, this.second);

        return this.state[((this.state[this.first] ?? 0) + (this.state[this.second] ?? 0)) & 0xff] ?? 0;
    }

    private swap(left: number, right: number): void {
        const held = this.state[left] ?? 0;
        this.state[left] = this.state[right] ?? 0;
        this.state[right] = held;
    }
}
