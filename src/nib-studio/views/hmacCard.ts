import { parseBase64 } from '../../common/encoding/base64.js';
import { succeed, type CodecError, type CodecResult } from '../../common/encoding/codecResult.js';
import { parseHex } from '../../common/encoding/hex.js';
import { encodeUtf8 } from '../../common/encoding/utf8.js';
import { formatDigest } from '../../common/hash/digestFormat.js';
import { HMAC_ALGORITHMS, hmacAllAsync } from '../../common/hash/hmac.js';
import { h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import type { KeyEncoding } from './hashSurfaceState.js';
import { verifyMatches } from './verifyCard.js';
import {
    buildDigestList,
    buildFormatSelect,
    buildHint,
    buildLabel,
    buildMessage,
    buildToolCard,
    describeError,
    runOnEnter,
    selectError,
    showMessage,
    toolId,
    type ToolCard,
    type ToolCardContext,
} from './toolCard.js';

const KEY_ENCODINGS: ReadonlyArray<{ readonly id: KeyEncoding; readonly label: string }> = [
    { id: 'text', label: 'Text' },
    { id: 'hex', label: 'Hex' },
    { id: 'base64', label: 'Base64' },
];

const KEY_PARSERS: Readonly<Record<KeyEncoding, (key: string) => CodecResult<Uint8Array>>> = Object.freeze({
    text: (key: string) => succeed<Uint8Array>(encodeUtf8(key)),
    hex: (key: string) => parseHex(key),
    base64: (key: string) => parseBase64(key),
});

export function buildHmacCard(context: ToolCardContext): ToolCard {
    const { state } = context;
    const hmac = state.hmac;
    const keyId = toolId('hmac', 'key');
    const encodingId = toolId('hmac', 'key-encoding');
    const messageId = toolId('hmac', 'message');
    const hintId = toolId('hmac', 'hint');

    const keyInput = h('input', {
        class: 'input input-mono',
        attrs: {
            'id': keyId,
            'type': 'text',
            'spellcheck': 'false',
            'autocomplete': 'off',
            'placeholder': 'Secret key',
            'aria-describedby': hintId,
        },
    });
    keyInput.value = hmac.key;

    const encodingSelect = h('select', { class: 'input tool-select', attrs: { 'id': encodingId, 'aria-label': 'Key encoding' } });

    for (const option of KEY_ENCODINGS) {
        encodingSelect.append(h('option', { text: option.label, attrs: { value: option.id } }));
    }

    encodingSelect.value = hmac.keyEncoding;

    const messageArea = h('textarea', {
        class: 'textarea textarea-mono tool-textarea',
        attrs: {
            'id': messageId,
            'rows': '3',
            'spellcheck': 'false',
            'placeholder': 'Message to sign',
            'aria-describedby': hintId,
        },
    });
    messageArea.value = hmac.message;

    const notice = buildMessage();
    const signatureList = buildDigestList(HMAC_ALGORITHMS.map((algorithm) => ({ key: `HMAC-${algorithm}`, label: `HMAC-${algorithm}` })));
    const formatSelect = buildFormatSelect(toolId('hmac', 'format'), hmac.format, (format) => {
        hmac.format = format;
        context.refresh();
    });

    keyInput.addEventListener('input', () => {
        hmac.key = keyInput.value;
    });

    messageArea.addEventListener('input', () => {
        hmac.message = messageArea.value;
    });

    const signFromFieldsAsync = async (): Promise<void> => {
        const keyError = await signAsync(context);

        if (keyError != null) {
            keyInput.focus();
            selectError(keyInput, keyError);
        }
    };

    encodingSelect.addEventListener('change', () => {
        hmac.keyEncoding = KEY_ENCODINGS.find((option) => option.id === encodingSelect.value)?.id ?? 'text';

        if (hmac.signatures != null || hmac.notice != null) {
            void signFromFieldsAsync();
        }
    });

    runOnEnter(keyInput, () => void signFromFieldsAsync());
    runOnEnter(messageArea, () => void signFromFieldsAsync());

    const update = (): void => {
        showMessage(notice, hmac.notice);
        const values = hmac.signatures == null
            ? null
            : new Map([...hmac.signatures].map(([algorithm, bytes]) => [`HMAC-${algorithm}`, formatDigest(bytes, hmac.format)]));
        signatureList.update(values, verifyMatches(state));
    };

    const element = buildToolCard({
        id: 'hmac',
        title: 'HMAC',
        children: [
            h('div', {
                class: 'tool-field',
                children: [
                    h('div', { class: 'tool-row', children: [buildLabel(keyId, 'Key'), h('span', { class: 'toolbar-spacer' }), encodingSelect] }),
                    keyInput,
                ],
            }),
            h('div', { class: 'tool-field', children: [buildLabel(messageId, 'Message'), messageArea] }),
            buildHint(hintId, 'Enter in either field to sign · Shift+Enter for a new line in the message'),
            notice,
            h('div', {
                class: 'tool-row',
                children: [h('span', { class: 'tool-label', text: 'Signatures' }), h('span', { class: 'toolbar-spacer' }), formatSelect],
            }),
            signatureList.element,
        ],
    });

    return { element, update };
}

// Signs the message with every algorithm; returns the key's error, if any, for the field to select.
// An empty key and message clear the card.
async function signAsync(context: ToolCardContext): Promise<CodecError | null> {
    const hmac = context.state.hmac;
    hmac.run += 1;
    const run = hmac.run;
    hmac.signatures = null;

    if (hmac.key === '') {
        hmac.notice = hmac.message === '' ? null : { text: 'Enter a key to sign the message.', tone: 'muted' };
        context.refresh();

        return null;
    }

    const key = KEY_PARSERS[hmac.keyEncoding](hmac.key);

    if (!key.ok) {
        hmac.notice = { text: `Key: ${describeError(key.error, hmac.key)}`, tone: 'fail' };
        context.refresh();

        return key.error;
    }

    if (key.value.length === 0) {
        hmac.notice = { text: 'The key holds no bytes.', tone: 'fail' };
        context.refresh();

        return null;
    }

    try {
        const signatures = await hmacAllAsync(key.value, encodeUtf8(hmac.message));

        if (run !== hmac.run) {
            return null;
        }

        hmac.signatures = signatures;
        hmac.notice = null;
    }
    catch (error) {
        if (run !== hmac.run) {
            return null;
        }

        hmac.notice = { text: `Could not sign: ${errorMessage(error)}`, tone: 'fail' };
    }

    context.refresh();

    return null;
}
