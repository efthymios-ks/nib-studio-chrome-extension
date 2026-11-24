// AES through Web Crypto, on data that is a whole number of 16-byte blocks with no padding of its own,
// as Office encrypts it. Web Crypto offers only CBC with PKCS#7 padding, so a block that decrypts to a full
// block of padding is added before decrypting, and ECB is CBC with each output block XORed back.

export const AES_BLOCK_SIZE = 16;

const FULL_PADDING = new Uint8Array(AES_BLOCK_SIZE).fill(AES_BLOCK_SIZE);
const ZERO_BLOCK = new Uint8Array(AES_BLOCK_SIZE);

// AES-128 and AES-256: the key sizes Chrome's Web Crypto accepts.
export const AES_KEY_SIZES: ReadonlySet<number> = new Set([16, 32]);

async function importKeyAsync(key: Uint8Array): Promise<CryptoKey> {
    if (!AES_KEY_SIZES.has(key.length)) {
        throw new Error(`AES keys of ${key.length * 8} bits can't be used here.`);
    }

    return await crypto.subtle.importKey('raw', copyOf(key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

function copyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(bytes);
}

function wholeBlocks(data: Uint8Array): Uint8Array {
    return data.subarray(0, data.length - (data.length % AES_BLOCK_SIZE));
}

// Decrypts AES-CBC data that carries no padding; a trailing part block is left out.
export async function decryptAesCbcAsync(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const blocks = wholeBlocks(data);

    if (blocks.length === 0) {
        return new Uint8Array(0);
    }

    const cryptoKey = await importKeyAsync(key);
    const lastBlock = blocks.subarray(blocks.length - AES_BLOCK_SIZE);
    // Encrypting a full block of padding after the last block gives the block that decrypts to it.
    const padding = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: copyOf(lastBlock) }, cryptoKey, FULL_PADDING));
    const input = new Uint8Array(blocks.length + AES_BLOCK_SIZE);
    input.set(blocks);
    input.set(padding.subarray(0, AES_BLOCK_SIZE), blocks.length);

    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: copyOf(iv) }, cryptoKey, input));
}

// Decrypts AES-ECB data: CBC from a zero IV XORs each block with the ciphertext block before it,
// which is undone here.
export async function decryptAesEcbAsync(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const blocks = wholeBlocks(data);
    const plain = await decryptAesCbcAsync(key, ZERO_BLOCK, blocks);

    for (let index = AES_BLOCK_SIZE; index < plain.length; index += 1) {
        plain[index] = (plain[index] ?? 0) ^ (blocks[index - AES_BLOCK_SIZE] ?? 0);
    }

    return plain;
}
