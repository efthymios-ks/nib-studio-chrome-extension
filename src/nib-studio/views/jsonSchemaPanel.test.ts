import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { generateSchema } from '../../common/json/schemaGenerator.js';
import { flushAsync } from '../testing/testHelpers.js';
import {
    createJsonSchemaPanelState,
    renderJsonSchemaPanel,
    SCHEMA_CHECK_DELAY_MS,
    startJsonSchemaPanelWith,
    type JsonSchemaPanelOptions,
    type JsonSchemaPanelState,
} from './jsonSchemaPanel.js';

const DOCUMENT = '{"name":"Ada","age":"old","tags":["a",2]}';
const SCHEMA = JSON.stringify({
    type: 'object',
    required: ['name', 'email'],
    properties: { age: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } } },
});

describe('renderJsonSchemaPanel', () => {
    let pane: HTMLElement;
    let state: JsonSchemaPanelState;
    let writeText: Mock<(text: string) => Promise<void>>;

    beforeEach(() => {
        pane = document.createElement('div');
        document.body.append(pane);
        state = createJsonSchemaPanelState();
        writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        pane.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    function render(overrides: Partial<JsonSchemaPanelOptions> = {}): JsonSchemaPanelOptions {
        const options: JsonSchemaPanelOptions = { text: DOCUMENT, state, onReveal: vi.fn(), ...overrides };
        renderJsonSchemaPanel(pane, options);

        return options;
    }

    const box = (): HTMLTextAreaElement => pane.querySelector<HTMLTextAreaElement>('.schema-input')!;
    const status = (): HTMLElement => pane.querySelector<HTMLElement>('.path-query-status')!;
    const cards = (): HTMLElement[] => [...pane.querySelectorAll<HTMLElement>('.path-card')];
    const modeButton = (mode: string): HTMLButtonElement => pane.querySelector<HTMLButtonElement>(`.schema-mode [data-mode="${mode}"]`)!;

    function type(text: string, inputType = 'insertText'): void {
        box().value = text;
        box().dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    }

    function errors(): Array<[string, string, string]> {
        return cards().map((card) => [
            card.querySelector('.path-card-path')?.textContent ?? '',
            card.querySelector('.path-card-type')?.textContent ?? '',
            card.querySelector('.path-card-message')?.textContent ?? '',
        ]);
    }

    describe('Validate', () => {
        it('opens in Validate with an empty box, a hint and no Check button', () => {
            render();

            expect(modeButton('validate').getAttribute('aria-pressed')).toBe('true');
            expect(modeButton('validate').dataset['active']).toBe('true');
            expect(box().getAttribute('placeholder')).toBe('Paste a JSON Schema to check this document against it.');
            expect(status().textContent).toBe('Paste a JSON Schema to check this document against it.');
            expect(pane.querySelector('.path-query-hint')?.textContent).toBe('Checks as you type · Draft 2020-12');
            expect([...pane.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Validate', 'Generate', 'Sample']);
            expect(pane.querySelector('[style]')).toBeNull();
        });

        it('checks once typing rests, and remembers the schema at once', () => {
            vi.useFakeTimers();
            render();
            type(SCHEMA);

            expect(state.schema).toBe(SCHEMA);
            expect(cards()).toHaveLength(0);

            vi.advanceTimersByTime(SCHEMA_CHECK_DELAY_MS - 1);
            expect(cards()).toHaveLength(0);

            vi.advanceTimersByTime(1);

            expect(status().textContent).toBe('3 errors');
            expect(status().dataset['tone']).toBe('fail');
            expect(errors()).toEqual([
                ['$', 'required', 'Missing required property "email".'],
                ['$/age', 'type', 'Expected number, found string.'],
                ['$/tags/1', 'type', 'Expected string, found number.'],
            ]);
        });

        it('checks a paste at once', () => {
            render();
            type(SCHEMA, 'insertFromPaste');

            expect(status().textContent).toBe('3 errors');
        });

        it('checks at once on Ctrl+Enter', () => {
            vi.useFakeTimers();
            render();
            type('{"type":"object"}');
            box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));

            expect(status().textContent).toBe('OK — 1 keyword checked.');
            expect(status().dataset['tone']).toBe('ok');
            expect(cards()).toHaveLength(0);
        });

        it('checks the remembered schema when it opens', () => {
            state.schema = SCHEMA;
            render();

            expect(box().value).toBe(SCHEMA);
            expect(status().textContent).toBe('3 errors');
        });

        it('reports each change to the box, by typing and by undo', () => {
            const onSchemaChange = vi.fn();
            render({ onSchemaChange });
            type('{"type":"object"}', 'insertFromPaste');
            type('{"type":"array"}', 'insertFromPaste');
            box().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));

            expect(onSchemaChange.mock.calls).toEqual([['{"type":"object"}'], ['{"type":"array"}'], ['{"type":"object"}']]);
        });

        it('says why a schema can\'t be used', () => {
            state.schema = '{"type":';
            render();

            expect(status().dataset['tone']).toBe('fail');
            expect(status().textContent).not.toBe('');
            expect(cards()).toHaveLength(0);

            type('[1]', 'insertFromPaste');

            expect(status().textContent).toBe('A schema must be a JSON object, true or false.');
        });

        it('says when the document is not valid JSON', () => {
            state.schema = SCHEMA;
            render({ text: '{"a": }' });

            expect(status().textContent).toMatch(/^Document is not valid JSON: .+ \(line 1, column \d+\)\.$/);
        });

        it('copies nothing when an error is clicked, and the error on Ctrl+C', async () => {
            state.schema = SCHEMA;
            render();
            cards()[1]!.querySelector('.path-card-path')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
            cards()[1]!.querySelector('.path-card-message')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
            await flushAsync();

            expect(writeText).not.toHaveBeenCalled();

            cards()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
            await flushAsync();

            expect(writeText).toHaveBeenCalledWith('$/age: Expected number, found string.');
        });

        it('shows an error\'s node in the tree from double-click, Enter and ↗', () => {
            state.schema = SCHEMA;
            const options = render();

            cards()[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            cards()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            cards()[0]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();

            expect((options.onReveal as Mock).mock.calls.map((call) => call[0])).toEqual(['$.age', '$.tags[1]', '$']);
        });

        it('moves between error cards with the arrow keys', () => {
            state.schema = SCHEMA;
            render();
            cards()[0]!.focus();
            cards()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

            expect(document.activeElement).toBe(cards()[1]);
        });
    });

    describe('Generate', () => {
        it('infers a schema from the document and shows it formatted and coloured', () => {
            render();
            modeButton('generate').click();

            expect(state.mode).toBe('generate');
            expect(modeButton('generate').getAttribute('aria-pressed')).toBe('true');

            const output = pane.querySelector<HTMLElement>('.schema-output')!;
            expect(output.textContent).toBe(JSON.stringify(generateSchema(JSON.parse(DOCUMENT)), null, 2));
            expect(output.querySelector('.json-key')?.textContent).toBe('"$schema"');
            expect(output.querySelector('.json-string')?.textContent).toBe('"https://json-schema.org/draft/2020-12/schema"');
            expect(status().textContent).toBe('Inferred from this document · Draft 2020-12');
            expect(pane.querySelector('.schema-input')).toBeNull();
        });

        it('opens in the remembered mode and regenerates from the document it is given', () => {
            state.mode = 'generate';
            render({ text: '{"id":1}' });

            expect(pane.querySelector('.schema-output')?.textContent).toContain('"integer"');

            pane.replaceChildren();
            render({ text: '{"id":"x"}' });

            expect(pane.querySelector('.schema-output')?.textContent).toContain('"string"');
        });

        it('copies nothing when the schema is clicked, so it selects like plain text', async () => {
            state.mode = 'generate';
            render();
            const output = pane.querySelector<HTMLElement>('.schema-output')!;
            output.click();
            output.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await flushAsync();

            expect(writeText).not.toHaveBeenCalled();
            expect(output.hasAttribute('title')).toBe(false);
            expect(output.hasAttribute('tabindex')).toBe(false);
        });

        it('puts the schema in the Validate box with Use to validate, where the document passes it', () => {
            state.mode = 'generate';
            const onSchemaChange = vi.fn();
            render({ onSchemaChange });
            pane.querySelector<HTMLButtonElement>('.schema-use')!.click();
            const generated = JSON.stringify(generateSchema(JSON.parse(DOCUMENT)), null, 2);

            expect(state.mode).toBe('validate');
            expect(box().value).toBe(generated);
            expect(onSchemaChange).toHaveBeenCalledWith(generated);
            expect(status().textContent).toMatch(/^OK — \d+ keywords checked\.$/);
            expect(document.activeElement).toBe(box());
        });

        it('says when the document is not valid JSON', () => {
            state.mode = 'generate';
            render({ text: '[1,' });

            expect(status().textContent).toMatch(/^Document is not valid JSON: /);
            expect(pane.querySelector('.schema-output')).toBeNull();
            expect(pane.querySelector('.schema-use')).toBeNull();
        });
    });

    describe('Sample', () => {
        const PERSON = JSON.stringify({
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 18 }, email: { type: 'string', format: 'email' } },
            required: ['name', 'email'],
        });
        const output = (): HTMLElement => pane.querySelector<HTMLElement>('.schema-output')!;
        const requiredOnly = (): HTMLInputElement => pane.querySelector<HTMLInputElement>('#schema-required-only')!;
        const notes = (): string[] => [...pane.querySelectorAll('.schema-notes li')].map((note) => note.textContent ?? '');

        function openSample(overrides: Partial<JsonSchemaPanelOptions> = {}): void {
            render(overrides);
            modeButton('sample').click();
        }

        it('builds a sample from the schema in the box, formatted and coloured like Generate', () => {
            state.schema = PERSON;
            openSample();

            expect(state.mode).toBe('sample');
            expect(modeButton('sample').getAttribute('aria-pressed')).toBe('true');
            expect(box().value).toBe(PERSON);
            expect(output().textContent).toBe(JSON.stringify({ name: 'string', age: 18, email: 'user@example.com' }, null, 2));
            expect(output().querySelector('.json-key')?.textContent).toBe('"name"');
            expect(output().querySelector('.json-number')?.textContent).toBe('18');
            expect(status().textContent).toBe('Passes the schema');
            expect(status().dataset['tone']).toBe('ok');
            expect(pane.querySelector('.path-query-hint')?.textContent).toBe('Updates as you type · Draft 2020-12');
            expect(requiredOnly().checked).toBe(false);
            expect(pane.querySelector('[style]')).toBeNull();
        });

        it('shares one schema box with Validate', () => {
            openSample();
            type(PERSON, 'insertFromPaste');
            modeButton('validate').click();

            expect(box().value).toBe(PERSON);

            type('{"type":"integer"}', 'insertFromPaste');
            modeButton('sample').click();

            expect(box().value).toBe('{"type":"integer"}');
            expect(output().textContent).toBe('0');
        });

        it('rebuilds once typing rests, at once on paste and at once on Ctrl+Enter', () => {
            vi.useFakeTimers();
            openSample();
            type('{"type":"boolean"}');

            expect(output().hidden).toBe(true);

            vi.advanceTimersByTime(SCHEMA_CHECK_DELAY_MS);

            expect(output().textContent).toBe('true');

            type('{"type":"null"}', 'insertFromPaste');

            expect(output().textContent).toBe('null');

            type('{"type":"string"}');
            box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));

            expect(output().textContent).toBe('"string"');
        });

        it('limits objects to their required properties with Required only, and remembers it', () => {
            state.schema = PERSON;
            openSample();
            requiredOnly().checked = true;
            requiredOnly().dispatchEvent(new Event('change', { bubbles: true }));

            expect(state.isRequiredOnly).toBe(true);
            expect(output().textContent).toBe(JSON.stringify({ name: 'string', email: 'user@example.com' }, null, 2));

            pane.replaceChildren();
            render();

            expect(requiredOnly().checked).toBe(true);
            expect(output().textContent).not.toContain('age');
        });

        it('works when the open document is not valid JSON', () => {
            state.schema = PERSON;
            openSample({ text: '{"a": ' });

            expect(status().dataset['tone']).toBe('ok');
            expect(output().textContent).toContain('"user@example.com"');
        });

        it('asks for a schema when the box is empty', () => {
            openSample();

            expect(status().textContent).toBe('Paste a JSON Schema to build a sample document that passes it.');
            expect(box().getAttribute('placeholder')).toBe('Paste a JSON Schema to build a sample document that passes it.');
            expect(output().hidden).toBe(true);
        });

        it('says why a schema can\'t be used, as Validate does', () => {
            openSample();
            type('[1]', 'insertFromPaste');

            expect(status().textContent).toBe('A schema must be a JSON object, true or false.');
            expect(status().dataset['tone']).toBe('fail');
            expect(output().hidden).toBe(true);

            type('{"$ref":"#/$defs/missing"}', 'insertFromPaste');

            expect(status().textContent).toBe('Cannot resolve $ref "#/$defs/missing"; only references within this schema work.');
        });

        it('lists the keywords the sample doesn\'t satisfy under it', () => {
            state.schema = JSON.stringify({
                type: 'object',
                properties: { code: { type: 'string', pattern: '^(?=.*\\d)(?=.*[A-Z]).{8}$' } },
                required: ['code'],
            });
            openSample();

            expect(status().textContent).toBe('1 keyword not satisfied');
            expect(status().dataset['tone']).toBe('warn');
            expect(notes()).toEqual(['pattern at $.code not satisfied; edit the value']);
            expect([...pane.querySelectorAll('.schema-notes code')].map((code) => code.textContent)).toEqual(['pattern', '$.code']);
            expect(output().textContent).toContain('"code"');
        });

        it('copies nothing when the sample is clicked, so it selects like plain text', async () => {
            state.schema = PERSON;
            openSample();
            output().click();
            await flushAsync();

            expect(writeText).not.toHaveBeenCalled();
            expect(output().hasAttribute('title')).toBe(false);
            expect(pane.textContent).not.toMatch(/to copy/i);
        });

        it('opens in Sample when that mode was left open', () => {
            state.mode = 'sample';
            state.schema = '{"const":42}';
            render();

            expect(modeButton('sample').dataset['active']).toBe('true');
            expect(output().textContent).toBe('42');
        });
    });
});

describe('startJsonSchemaPanelWith', () => {
    const SCHEMA_TEXT = '{"type":"object"}';

    it('gives a box that never held a schema one to start with, and nothing to undo', () => {
        const state = createJsonSchemaPanelState();
        const pane = document.createElement('div');
        renderJsonSchemaPanel(pane, { text: '{}', state, onReveal: vi.fn() });
        startJsonSchemaPanelWith(state, SCHEMA_TEXT);
        pane.replaceChildren();
        renderJsonSchemaPanel(pane, { text: '{}', state, onReveal: vi.fn() });
        const box = pane.querySelector<HTMLTextAreaElement>('.schema-input')!;
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));

        expect(box.value).toBe(SCHEMA_TEXT);
        expect(state.history.done).toHaveLength(0);
        expect(pane.querySelector('.path-query-status')?.textContent).toBe('OK — 1 keyword checked.');
    });

    it('leaves a box alone once it has held a schema, even when emptied since', () => {
        const state = createJsonSchemaPanelState();
        const pane = document.createElement('div');
        renderJsonSchemaPanel(pane, { text: '{}', state, onReveal: vi.fn() });
        const box = pane.querySelector<HTMLTextAreaElement>('.schema-input')!;
        box.value = '{"type":"array"}';
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
        box.value = '';
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        startJsonSchemaPanelWith(state, SCHEMA_TEXT);

        expect(state.schema).toBe('');

        state.schema = '{"type":"string"}';
        startJsonSchemaPanelWith(state, SCHEMA_TEXT);

        expect(state.schema).toBe('{"type":"string"}');
    });
});
