import { showDialogAsync, type DialogButton } from '../app/dialog.js';
import { clear, h } from '../app/dom.js';

export interface FieldPickerOptions {
    readonly title: string;
    readonly hint: string;
    readonly fields: ReadonlyArray<string>;
    readonly selected: ReadonlyArray<string>;
}

export interface FieldPicker {
    readonly element: HTMLElement;
    readonly getSelected: () => string[];
}

// Wording family: arrays (JSON), repeated elements (XML) or rows (tables).
export type RuleTarget = 'array' | 'element' | 'rows';

export interface RuleDialogOptions {
    readonly target: RuleTarget;
    readonly path: string;
    readonly fields: ReadonlyArray<string>;
    readonly matchBy: ReadonlyArray<string>;
    readonly sortBy: ReadonlyArray<string>;
    readonly existing: boolean;
}

export type RuleDialogResult =
    | { readonly action: 'save'; readonly matchBy: string[]; readonly sortBy: string[] }
    | { readonly action: 'remove' }
    | null;

export function createFieldPicker(options: FieldPickerOptions): FieldPicker {
    const selected = options.selected.filter((field, index, list) => list.indexOf(field) === index);
    const fields = sortFieldNames(new Set([...options.fields, ...selected]));
    const optionsList = h('div', { class: 'rule-picker-options' });
    const orderList = h('ol', { class: 'rule-picker-order' });
    const checkboxes = new Map<string, HTMLInputElement>();

    const render = (): void => {
        for (const [field, checkbox] of checkboxes) {
            checkbox.checked = selected.includes(field);
        }

        clear(orderList);

        if (selected.length === 0) {
            orderList.dataset['empty'] = 'true';
            orderList.append(h('li', {
                class: 'rule-picker-empty',
                text: 'No fields picked.',
            }));

            return;
        }

        delete orderList.dataset['empty'];
        selected.forEach((field, index) => {
            orderList.append(buildOrderRow({ field, index, selected, render }));
        });
    };

    if (fields.length === 0) {
        optionsList.append(h('p', {
            class: 'rule-picker-empty',
            text: 'No fields were found on these items.',
        }));
    }

    for (const field of fields) {
        const checkbox = h('input', { attrs: { type: 'checkbox', value: field } });
        checkbox.addEventListener('change', () => {
            const at = selected.indexOf(field);

            if (checkbox.checked && at < 0) {
                selected.push(field);
            }
            else if (!checkbox.checked && at >= 0) {
                selected.splice(at, 1);
            }

            render();
        });
        checkboxes.set(field, checkbox);
        optionsList.append(h('label', {
            class: 'rule-picker-option',
            children: [checkbox, h('span', { class: 'mono', text: field })],
        }));
    }

    render();

    const element = h('section', {
        class: 'rule-picker',
        children: [
            h('h3', { class: 'rule-picker-title', text: options.title }),
            h('p', { class: 'rule-picker-hint', text: options.hint }),
            optionsList,
            h('div', {
                class: 'rule-picker-order-label',
                text: 'Order',
            }),
            orderList,
        ],
    });

    return { element, getSelected: () => [...selected] };
}

export async function showRuleDialogAsync(options: RuleDialogOptions): Promise<RuleDialogResult> {
    const wording = ruleWording(options.target);
    const matchPicker = createFieldPicker({
        title: wording.matchTitle,
        hint: wording.matchHint,
        fields: options.fields,
        selected: options.matchBy,
    });
    const sortPicker = createFieldPicker({
        title: wording.sortTitle,
        hint: wording.sortHint,
        fields: options.fields,
        selected: options.sortBy,
    });
    const body = h('div', {
        class: 'rule-dialog',
        children: [
            h('code', { class: 'rule-dialog-path mono', text: options.path }),
            matchPicker.element,
            sortPicker.element,
        ],
    });
    const buttons: DialogButton[] = [
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save rule', tone: 'primary', primary: true },
    ];

    if (options.existing) {
        buttons.unshift({ id: 'remove', label: 'Remove', tone: 'danger' });
    }

    const result = await showDialogAsync({
        title: options.existing ? wording.editTitle : wording.addTitle,
        bodyNode: body,
        kind: { kind: 'buttons', buttons },
    });

    if (result.outcome !== 'button' || result.id === 'cancel') {
        return null;
    }

    if (result.id === 'remove') {
        return { action: 'remove' };
    }

    return { action: 'save', matchBy: matchPicker.getSelected(), sortBy: sortPicker.getSelected() };
}

export interface RuleSummaryOptions {
    readonly target: RuleTarget;
    readonly path: string;
    readonly matchBy: ReadonlyArray<string>;
    readonly sortBy: ReadonlyArray<string>;
    readonly onEdit: () => void;
    readonly onRemove: () => void;
}

// One rule in a rules list: its path, match and sort fields, and Edit / Remove.
export function buildRuleSummary(options: RuleSummaryOptions): HTMLElement {
    const wording = ruleWording(options.target);
    const none = 'none';

    return h('div', {
        class: 'rule-summary',
        dataset: { path: options.path },
        children: [
            h('div', { class: 'rule-summary-path mono', attrs: { title: options.path }, text: options.path }),
            h('div', {
                class: 'rule-summary-fields',
                children: [
                    h('span', {
                        class: 'rule-summary-chip',
                        text: `${wording.matchTitle}: ${options.matchBy.join(', ') || none}`,
                    }),
                    h('span', {
                        class: 'rule-summary-chip',
                        text: `${wording.sortTitle}: ${options.sortBy.join(', ') || none}`,
                    }),
                ],
            }),
            h('div', {
                class: 'rule-summary-actions',
                children: [
                    h('button', {
                        class: 'button',
                        dataset: { action: 'edit' },
                        text: 'Edit',
                        attrs: { type: 'button' },
                        on: { click: () => options.onEdit() },
                    }),
                    h('button', {
                        class: 'button',
                        dataset: { action: 'remove' },
                        text: 'Remove',
                        attrs: { type: 'button' },
                        on: { click: () => options.onRemove() },
                    }),
                ],
            }),
        ],
    });
}

interface RuleWording {
    readonly addTitle: string;
    readonly editTitle: string;
    readonly matchTitle: string;
    readonly matchHint: string;
    readonly sortTitle: string;
    readonly sortHint: string;
}

function ruleWording(target: RuleTarget): RuleWording {
    if (target === 'rows') {
        return {
            addTitle: 'Row matching',
            editTitle: 'Row matching',
            matchTitle: 'Match rows by',
            matchHint: 'Rows with the same values in these columns are compared with each other. The first column has the highest priority.',
            sortTitle: 'Sort rows by',
            sortHint: 'Both tables and the differences are listed in this order.',
        };
    }

    return {
        addTitle: target === 'element'
            ? 'Add element rule'
            : 'Add array rule',
        editTitle: target === 'element'
            ? 'Edit element rule'
            : 'Edit array rule',
        matchTitle: 'Match items by',
        matchHint: 'Items with the same values in these fields are compared with each other, wherever they sit.',
        sortTitle: 'Sort items by',
        sortHint: 'Both sides are sorted by these fields before comparing, so order changes are not reported.',
    };
}

interface OrderRowOptions {
    readonly field: string;
    readonly index: number;
    readonly selected: string[];
    readonly render: () => void;
}

function buildOrderRow(options: OrderRowOptions): HTMLElement {
    const { field, index, selected, render } = options;
    const move = (offset: number): void => {
        const target = index + offset;

        if (target < 0 || target >= selected.length) {
            return;
        }

        selected.splice(index, 1);
        selected.splice(target, 0, field);
        render();
    };

    return h('li', {
        class: 'rule-picker-item',
        dataset: { field },
        children: [
            h('span', { class: 'rule-picker-position', text: `${index + 1}` }),
            h('span', { class: 'rule-picker-name mono', text: field }),
            h('button', {
                class: 'icon-button',
                text: '↑',
                dataset: { action: 'up' },
                attrs: { type: 'button', disabled: index === 0, title: 'Move up', 'aria-label': 'Move up' },
                on: { click: () => move(-1) },
            }),
            h('button', {
                class: 'icon-button',
                text: '↓',
                dataset: { action: 'down' },
                attrs: { type: 'button', disabled: index === selected.length - 1, title: 'Move down', 'aria-label': 'Move down' },
                on: { click: () => move(1) },
            }),
            h('button', {
                class: 'icon-button',
                text: '×',
                dataset: { action: 'remove' },
                attrs: { type: 'button', title: 'Remove field', 'aria-label': 'Remove field' },
                on: {
                    click: () => {
                        selected.splice(index, 1);
                        render();
                    },
                },
            }),
        ],
    });
}

export function sortFieldNames(fields: Iterable<string>): string[] {
    return [...fields].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }) || left.localeCompare(right));
}
