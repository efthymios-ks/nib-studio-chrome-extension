import {
    countActiveRules,
    validateIgnorePattern,
    type TextCompareRules,
    type WhitespaceRule,
} from '../../common/text/textCompareRules.js';
import { showDialogAsync } from '../app/dialog.js';
import { h } from '../app/dom.js';
import { attachDiffPopover } from './diffPopover.js';

// The text diff's Compare rules button: a popover with what counts as a difference, each change applied at once.

export interface TextRulesMenuOptions {
    // The tab's text diff state; its popover stays open while the diff draws again.
    readonly state: { rules: TextCompareRules };
    // After a rule changed, to compare again.
    readonly onChange: () => void;
}

type RulesUpdate = (changes: Partial<TextCompareRules>) => void;

type BooleanRule = 'ignoreCase' | 'ignoreBlankLines' | 'normalizeLineEndings' | 'trimLines' | 'sortLines' | 'uniqueLines';

const WHITESPACE_CHOICES: ReadonlyArray<{ id: WhitespaceRule; label: string }> = Object.freeze([
    { id: 'none', label: 'Don\'t ignore' },
    { id: 'trailing', label: 'Trailing whitespace' },
    { id: 'amount', label: 'Changes in amount' },
    { id: 'all', label: 'All whitespace' },
]);

// The button reads `Compare rules · 2` while two rules differ from the defaults.
export function buildTextRulesMenu(options: TextRulesMenuOptions): HTMLButtonElement {
    const { state } = options;
    const count = countActiveRules(state.rules);
    const button = h('button', {
        class: 'button diff-rules-button',
        dataset: { action: 'compare-rules' },
        attrs: { type: 'button', title: 'What counts as a difference' },
        children: [
            'Compare rules',
            count === 0 ? null : h('span', { class: 'diff-rules-count', text: ` · ${count}` }),
        ],
    });

    attachDiffPopover({
        button,
        label: 'Compare rules',
        owner: state,
        build: (refresh) => {
            const update: RulesUpdate = (changes) => {
                state.rules = { ...state.rules, ...changes };
                refresh();
                options.onChange();
            };

            return buildRuleControls({ rules: state.rules, update, refresh });
        },
    });

    return button;
}

interface RuleControlsOptions {
    readonly rules: TextCompareRules;
    readonly update: RulesUpdate;
    // Draws the controls again, such as after a pattern dialog closed with nothing changed.
    readonly refresh: () => void;
}

function buildRuleControls(options: RuleControlsOptions): HTMLElement[] {
    const { rules, update } = options;

    return [
        h('div', { class: 'diff-rules-title', text: 'Compare rules' }),
        buildWhitespaceChoice(rules, update),
        buildRuleCheckbox({ rule: 'ignoreCase', label: 'Ignore case', rules, update }),
        buildRuleCheckbox({ rule: 'ignoreBlankLines', label: 'Ignore blank lines', rules, update }),
        buildRuleCheckbox({ rule: 'normalizeLineEndings', label: 'Normalise line endings (CRLF / LF)', rules, update }),
        buildRuleCheckbox({ rule: 'trimLines', label: 'Trim each line', rules, update }),
        buildRuleCheckbox({ rule: 'sortLines', label: 'Sort lines before comparing', rules, update }),
        buildRuleCheckbox({ rule: 'uniqueLines', label: 'Unique lines only', rules, update, nested: true, disabled: !rules.sortLines }),
        buildPatternList(options),
    ];
}

function buildWhitespaceChoice(rules: TextCompareRules, update: RulesUpdate): HTMLElement {
    const name = `text-rules-whitespace-${Math.random().toString(36).slice(2, 8)}`;

    return h('fieldset', {
        class: 'text-rules-group',
        dataset: { rule: 'whitespace' },
        children: [
            h('legend', { class: 'text-rules-label', text: 'Ignore whitespace' }),
            ...WHITESPACE_CHOICES.map((choice) => {
                const radio = h('input', { attrs: { type: 'radio', name, value: choice.id } });
                radio.checked = rules.whitespace === choice.id;
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        update({ whitespace: choice.id });
                    }
                });

                return h('label', { class: 'text-rules-option', children: [radio, h('span', { text: choice.label })] });
            }),
        ],
    });
}

interface RuleCheckboxOptions {
    readonly rule: BooleanRule;
    readonly label: string;
    readonly rules: TextCompareRules;
    readonly update: RulesUpdate;
    readonly nested?: boolean;
    readonly disabled?: boolean;
}

function buildRuleCheckbox(options: RuleCheckboxOptions): HTMLElement {
    const { rule, label, rules, update } = options;
    const checkbox = h('input', { attrs: { type: 'checkbox', disabled: options.disabled === true } });
    checkbox.checked = rules[rule];
    checkbox.addEventListener('change', () => update({ [rule]: checkbox.checked }));

    return h('label', {
        class: 'text-rules-option',
        dataset: options.nested === true ? { rule, nested: 'true' } : { rule },
        children: [checkbox, h('span', { text: label })],
    });
}

function buildPatternList(options: RuleControlsOptions): HTMLElement {
    const { rules, update } = options;
    const list = h('div', {
        class: 'text-rules-group',
        dataset: { rule: 'ignorePatterns' },
        children: [h('div', { class: 'text-rules-label', text: 'Ignore lines matching' })],
    });

    if (rules.ignorePatterns.length === 0) {
        list.append(h('p', { class: 'diff-rules-empty', text: 'No patterns. Lines matching a regular expression are left out of the comparison.' }));
    }

    rules.ignorePatterns.forEach((pattern, index) => {
        list.append(h('div', {
            class: 'rule-summary',
            dataset: { pattern },
            children: [
                h('div', { class: 'rule-summary-path mono', attrs: { title: pattern }, text: pattern }),
                h('div', {
                    class: 'rule-summary-actions',
                    children: [
                        h('button', {
                            class: 'button',
                            dataset: { action: 'edit' },
                            text: 'Edit',
                            attrs: { type: 'button' },
                            on: { click: () => { void editPatternAsync({ ...options, index }); } },
                        }),
                        h('button', {
                            class: 'button',
                            dataset: { action: 'remove' },
                            text: 'Remove',
                            attrs: { type: 'button' },
                            on: { click: () => update({ ignorePatterns: rules.ignorePatterns.filter((_, at) => at !== index) }) },
                        }),
                    ],
                }),
            ],
        }));
    });

    list.append(h('button', {
        class: 'diff-rules-add',
        dataset: { action: 'add-pattern' },
        attrs: { type: 'button' },
        text: '+ Add pattern',
        on: { click: () => { void editPatternAsync({ ...options, index: null }); } },
    }));

    return list;
}

interface EditPatternOptions extends RuleControlsOptions {
    readonly index: number | null;
}

async function editPatternAsync(options: EditPatternOptions): Promise<void> {
    const { index, rules, update } = options;
    const existing = index == null ? null : rules.ignorePatterns[index] ?? null;
    const result = await showDialogAsync({
        title: existing == null ? 'Add ignore pattern' : 'Edit ignore pattern',
        body: 'Lines matching this regular expression are left out of the comparison.',
        kind: {
            kind: 'input',
            initialValue: existing ?? '',
            placeholder: '^\\s*//',
            validate: validateIgnorePattern,
        },
    });

    if (result.outcome !== 'input') {
        // Back to the popover, on the button that asked.
        options.refresh();

        return;
    }

    const others = rules.ignorePatterns.filter((_, at) => at !== index);

    if (others.includes(result.value)) {
        update({ ignorePatterns: others });

        return;
    }

    const patterns = [...rules.ignorePatterns];

    if (index == null) {
        patterns.push(result.value);
    }
    else {
        patterns[index] = result.value;
    }

    update({ ignorePatterns: patterns });
}
