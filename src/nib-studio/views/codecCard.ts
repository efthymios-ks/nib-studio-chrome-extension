import { CODECS, findCodec, type CodecOptions } from '../../common/encoding/codecs.js';
import { h } from '../app/dom.js';
import type { CodecSide } from './hashSurfaceState.js';
import {
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

interface Pane {
    readonly side: CodecSide;
    readonly label: HTMLLabelElement;
    readonly field: HTMLTextAreaElement;
    readonly message: HTMLElement;
    readonly element: HTMLElement;
}

// Two text areas: Enter in the text encodes into the other side, Enter in the encoded side decodes back.
export function buildCodecCard(context: ToolCardContext): ToolCard {
    const codecState = context.state.codec;
    const hintId = toolId('codec', 'hint');
    const panes: Record<CodecSide, Pane> = {
        plain: buildPane('plain', hintId),
        encoded: buildPane('encoded', hintId),
    };
    const hint = buildHint(hintId, '');

    const codecSelect = h('select', { class: 'input tool-select', attrs: { id: toolId('codec', 'codec') } });

    for (const codec of CODECS) {
        codecSelect.append(h('option', { text: codec.label, attrs: { value: codec.id } }));
    }

    codecSelect.value = codecState.codec;

    const urlSafe = buildCheck(toolId('codec', 'url-safe'), 'URL-safe', codecState.urlSafe);
    const padding = buildCheck(toolId('codec', 'padding'), 'Padding', codecState.padding);
    const base64Options = h('span', { class: 'codec-options', children: [urlSafe.element, padding.element] });

    const options = (): CodecOptions => ({
        urlSafe: codecState.urlSafe,
        padding: codecState.padding,
        resolveEntity: resolveEntityWithBrowser,
    });

    const convert = (from: CodecSide): void => {
        const to: CodecSide = from === 'plain' ? 'encoded' : 'plain';
        const source = panes[from].field;
        const codec = findCodec(codecState.codec);
        const text = source.value;
        codecState[from] = text;
        codecState.source = from;
        codecState.messages = { plain: null, encoded: null };

        if (text === '') {
            panes[to].field.value = '';
            codecState[to] = '';
            codecState.output = null;
            update();

            return;
        }

        const result = from === 'plain' ? codec.encode(text, options()) : codec.decode(text, options());

        if (!result.ok) {
            codecState.messages[from] = { text: describeError(result.error, text), tone: 'fail' };
            codecState.output = null;
            update();
            selectError(source, result.error);

            return;
        }

        panes[to].field.value = result.value;
        codecState[to] = result.value;
        codecState.output = to;
        codecState.messages[from] = result.warning == null ? null : { text: describeError(result.warning, text), tone: 'warn' };
        update();
    };

    // A change of codec or option converts again from the side the user last worked in.
    const reconvert = (): void => {
        if (panes[codecState.source].field.value !== '') {
            convert(codecState.source);

            return;
        }

        codecState.messages = { plain: null, encoded: null };
        update();
    };

    for (const pane of Object.values(panes)) {
        pane.field.value = codecState[pane.side];
        runOnEnter(pane.field, () => convert(pane.side));

        pane.field.addEventListener('input', () => {
            codecState[pane.side] = pane.field.value;
            codecState.source = pane.side;

            if (codecState.output === pane.side) {
                codecState.output = null;
                update();
            }
        });
    }

    codecSelect.addEventListener('change', () => {
        codecState.codec = CODECS.find((codec) => codec.id === codecSelect.value)?.id ?? 'base64';
        reconvert();
    });

    urlSafe.input.addEventListener('change', () => {
        codecState.urlSafe = urlSafe.input.checked;

        if (codecState.source === 'plain') {
            reconvert();
        }
    });

    padding.input.addEventListener('change', () => {
        codecState.padding = padding.input.checked;

        if (codecState.source === 'plain') {
            reconvert();
        }
    });

    const update = (): void => {
        const codec = findCodec(codecState.codec);
        panes.encoded.label.textContent = codec.encodedLabel;
        base64Options.hidden = codec.id !== 'base64';
        hint.textContent = `Enter in Text encodes · Enter in ${codec.encodedLabel} decodes · Shift+Enter for a new line`;

        for (const pane of Object.values(panes)) {
            pane.field.dataset['output'] = String(codecState.output === pane.side);
            showMessage(pane.message, codecState.messages[pane.side]);
        }
    };

    const element = buildToolCard({
        id: 'codec',
        title: 'Encode / Decode',
        tools: [
            h('span', { class: 'toolbar-spacer' }),
            h('span', { class: 'tool-inline', children: [buildLabel(codecSelect.id, 'Codec'), codecSelect] }),
            base64Options,
        ],
        children: [
            h('div', { class: 'codec-panes', children: [panes.plain.element, panes.encoded.element] }),
            hint,
        ],
    });

    return { element, update };
}

function buildPane(side: CodecSide, hintId: string): Pane {
    const id = toolId('codec', side);
    const label = buildLabel(id, side === 'plain' ? 'Text' : 'Encoded');
    const field = h('textarea', {
        class: 'textarea textarea-mono tool-textarea codec-field',
        attrs: { 'id': id, 'rows': '5', 'spellcheck': 'false', 'aria-describedby': hintId },
    });
    const message = buildMessage();

    return {
        side,
        label,
        field,
        message,
        element: h('div', { class: 'tool-field codec-pane', dataset: { side }, children: [label, field, message] }),
    };
}

function buildCheck(id: string, text: string, checked: boolean): { readonly element: HTMLElement; readonly input: HTMLInputElement } {
    const input = h('input', { attrs: { id, type: 'checkbox' } });
    input.checked = checked;

    return { element: h('label', { class: 'tool-check', attrs: { for: id }, children: [input, text] }), input };
}

// Named references beyond the common ones come from the browser's own HTML table. The name is letters and
// digits only, and a text area's content is never parsed as markup, so nothing but the character comes back.
function resolveEntityWithBrowser(name: string): string | null {
    const probe = document.createElement('textarea');
    probe.innerHTML = `&${name};`;

    return probe.value === `&${name};` ? null : probe.value;
}
