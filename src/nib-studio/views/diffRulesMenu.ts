import { h } from '../app/dom.js';
import { attachDiffPopover, closeDiffPopover } from './diffPopover.js';
import { buildRuleSummary } from './diffRulePicker.js';

// The toolbar's Rules (n) button of the JSON and XML diffs: a popover that lists the rules, each with Edit and Remove.

export interface DiffRule {
    readonly path: string;
    readonly matchBy?: ReadonlyArray<string>;
    readonly sortBy?: ReadonlyArray<string>;
}

export interface RulesMenuOptions {
    readonly target: 'array' | 'element';
    readonly rules: ReadonlyArray<DiffRule>;
    readonly onEdit: (rule: DiffRule) => void;
    readonly onRemove: (rule: DiffRule) => void;
}

// Null when there are no rules; rules are added by clicking the `[` of an array or repeated element in the grid.
// Drawing the diff again closes a popover left open, so it never acts on a diff that is gone.
export function buildRulesMenu(options: RulesMenuOptions): HTMLElement | null {
    if (options.rules.length === 0) {
        closeDiffPopover();

        return null;
    }

    const title = options.target === 'array' ? 'Array rules' : 'Element rules';
    const button = h('button', {
        class: 'button diff-rules-button',
        dataset: { action: 'rules' },
        text: `Rules (${options.rules.length})`,
        attrs: {
            type: 'button',
            title: options.target === 'array'
                ? 'How the items of arrays are matched and sorted'
                : 'How repeated elements are matched and sorted',
        },
    });

    attachDiffPopover({
        button,
        label: title,
        build: () => [
            h('div', { class: 'diff-rules-title', text: title }),
            ...options.rules.map((rule) => buildRuleSummary({
                target: options.target,
                path: rule.path,
                matchBy: rule.matchBy ?? [],
                sortBy: rule.sortBy ?? [],
                onEdit: () => {
                    closeDiffPopover();
                    options.onEdit(rule);
                },
                onRemove: () => {
                    closeDiffPopover();
                    options.onRemove(rule);
                },
            })),
        ],
    });

    return button;
}
