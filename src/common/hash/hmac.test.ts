import { describe, expect, it } from 'vitest';
import { bytesToHex } from '../encoding/hex.js';
import { HMAC_ALGORITHMS, hmacAllAsync, hmacAsync, type HmacAlgorithm } from './hmac.js';

interface HmacVector {
    readonly name: string;
    readonly key: Uint8Array;
    readonly data: Uint8Array;
    readonly expected: Partial<Record<HmacAlgorithm, string>>;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const repeat = (byte: number, length: number): Uint8Array => new Uint8Array(length).fill(byte);

// RFC 2202 for HMAC-SHA-1; RFC 4231 for HMAC-SHA-256, -384 and -512.
const VECTORS: ReadonlyArray<HmacVector> = [
    {
        name: 'test case 1',
        key: repeat(0x0b, 20),
        data: text('Hi There'),
        expected: {
            'SHA-1': 'b617318655057264e28bc0b6fb378c8ef146be00',
            'SHA-256': 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
            'SHA-384': 'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
            'SHA-512': '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
        },
    },
    {
        name: 'test case 2, a key shorter than the output',
        key: text('Jefe'),
        data: text('what do ya want for nothing?'),
        expected: {
            'SHA-1': 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
            'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
            'SHA-384': 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
            'SHA-512': '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
        },
    },
    {
        name: 'test case 3, binary key and data',
        key: repeat(0xaa, 20),
        data: repeat(0xdd, 50),
        expected: {
            'SHA-1': '125d7342b9ac11cd91a39af48aa17b4f63f175d3',
            'SHA-256': '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
            'SHA-384': '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27',
            'SHA-512': 'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb',
        },
    },
    {
        name: 'RFC 2202 test case 6, a key larger than the block',
        key: repeat(0xaa, 80),
        data: text('Test Using Larger Than Block-Size Key - Hash Key First'),
        expected: {
            'SHA-1': 'aa4ae5e15272d00e95705637ce8a3b55ed402112',
        },
    },
    {
        name: 'RFC 4231 test case 6, a key larger than the block',
        key: repeat(0xaa, 131),
        data: text('Test Using Larger Than Block-Size Key - Hash Key First'),
        expected: {
            'SHA-256': '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
            'SHA-384': '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
            'SHA-512': '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
        },
    },
];

describe('hmacAsync', () => {
    for (const vector of VECTORS) {
        for (const [algorithm, expected] of Object.entries(vector.expected) as Array<[HmacAlgorithm, string]>) {
            it(`HMAC-${algorithm} matches ${vector.name}`, async () => {
                expect(bytesToHex(await hmacAsync(vector.key, vector.data, algorithm))).toBe(expected);
            });
        }
    }
});

describe('hmacAllAsync', () => {
    it('signs with every algorithm', async () => {
        const signatures = await hmacAllAsync(text('Jefe'), text('what do ya want for nothing?'));

        expect([...signatures.keys()]).toEqual([...HMAC_ALGORITHMS]);
        expect(bytesToHex(signatures.get('SHA-256') as Uint8Array)).toBe(VECTORS[1]?.expected['SHA-256']);
    });
});
