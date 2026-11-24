import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from '../app/dom.js';
import { attachDiffPopover, closeDiffPopover, type DiffPopoverOptions } from './diffPopover.js';
import { flushAsync, pressKey } from '../testing/testHelpers.js';

interface Setup {
    readonly button: HTMLButtonElement;
    readonly refresh: () => void;
    readonly builds: ReturnType<typeof vi.fn>;
}

function popover(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.diff-rules-popover');
}

function controls(): HTMLElement[] {
    return Array.from(popover()?.querySelectorAll<HTMLElement>('button, input') ?? []);
}

function buildControls(): HTMLElement[] {
    const radio = (value: string, checked: boolean): HTMLElement => {
        const input = h('input', { attrs: { type: 'radio', name: 'spacing', value } });
        input.checked = checked;

        return h('label', { children: [input, value] });
    };

    return [
        h('div', { class: 'diff-rules-title', text: 'Rules' }),
        radio('none', false),
        radio('all', true),
        h('label', { children: [h('input', { attrs: { type: 'checkbox' } }), 'Ignore case'] }),
        h('button', { attrs: { type: 'button' }, dataset: { action: 'add' }, text: 'Add' }),
    ];
}

function setUp(options: Partial<DiffPopoverOptions> = {}): Setup {
    const button = h('button', { attrs: { type: 'button' }, text: 'Rules' });
    const holder: { refresh: () => void } = { refresh: () => {} };
    const builds = vi.fn((refresh: () => void) => {
        holder.refresh = refresh;

        return buildControls();
    });
    document.body.append(button);
    attachDiffPopover({ button, label: 'Test rules', build: builds, ...options });

    return { button, refresh: () => holder.refresh(), builds };
}

describe('attachDiffPopover', () => {
    afterEach(() => {
        closeDiffPopover();
        document.body.replaceChildren();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('opens under its button as a dialog, focusing its first control', () => {
        const { button } = setUp();

        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(popover()).toBeNull();

        button.click();

        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popover()?.getAttribute('role')).toBe('dialog');
        expect(popover()?.getAttribute('aria-label')).toBe('Test rules');
        expect(popover()?.querySelector('.diff-rules-title')?.textContent).toBe('Rules');
        // The radio group's stop is its checked radio.
        expect(document.activeElement).toBe(popover()?.querySelector('input[value="all"]'));
    });

    it('closes on Esc and on the button again, with focus back on the button', () => {
        const { button } = setUp();

        button.click();
        const escape = pressKey(document.activeElement!, 'Escape');
        expect(escape.defaultPrevented).toBe(true);
        expect(popover()).toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button);

        button.click();
        controls()[2]!.focus();
        button.click();
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(button);
    });

    it('closes on a click outside, but not on a click inside it or on its button', () => {
        const { button } = setUp();
        const outside = h('div', { text: 'diff' });
        document.body.append(outside);

        button.click();
        popover()!.querySelector('label')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(popover()).not.toBeNull();

        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(popover()).toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('wraps Tab inside it and moves between controls with the arrow keys, leaving radios their own arrows', () => {
        const { button } = setUp();
        button.click();
        const [, checkedRadio, checkbox, add] = controls();

        add!.focus();
        expect(pressKey(add!, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(checkedRadio);

        expect(pressKey(checkedRadio!, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(add);

        checkbox!.focus();
        expect(pressKey(checkbox!, 'Tab').defaultPrevented).toBe(false);

        expect(pressKey(checkbox!, 'ArrowDown').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(add);
        pressKey(add!, 'ArrowDown');
        expect(document.activeElement).toBe(checkedRadio);
        add!.focus();
        pressKey(add!, 'ArrowUp');
        expect(document.activeElement).toBe(checkbox);

        expect(pressKey(checkedRadio!, 'ArrowDown').defaultPrevented).toBe(false);
    });

    it('leaves keys and clicks in a dialog opened over it alone', () => {
        const { button } = setUp();
        button.click();
        const field = h('input', { attrs: { type: 'text' } });
        document.body.append(h('div', { class: 'modal-backdrop', children: [h('div', { class: 'modal', children: [field] })] }));
        field.focus();

        expect(pressKey(field, 'Escape').defaultPrevented).toBe(false);
        expect(pressKey(field, 'Tab').defaultPrevented).toBe(false);
        field.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(popover()).not.toBeNull();
    });

    it('draws its content again in place, keeping focus on the same control', () => {
        const { button, refresh, builds } = setUp();
        button.click();
        const element = popover();
        controls()[3]!.focus();

        refresh();

        expect(builds).toHaveBeenCalledTimes(2);
        expect(popover()).toBe(element);
        expect(document.activeElement).toBe(controls()[3]);
        expect(document.activeElement?.isConnected).toBe(true);
    });

    it('finds the same control again when controls before it come and go', () => {
        const button = h('button', { attrs: { type: 'button' }, text: 'Rules' });
        const patterns: string[] = [];
        const holder: { refresh: () => void } = { refresh: () => {} };
        document.body.append(button);
        attachDiffPopover({
            button,
            label: 'Patterns',
            build: (refresh) => {
                holder.refresh = refresh;

                return [
                    ...patterns.map((pattern) => h('div', {
                        dataset: { pattern },
                        children: [h('button', { attrs: { type: 'button' }, dataset: { action: 'edit' }, text: 'Edit' })],
                    })),
                    h('button', { attrs: { type: 'button' }, dataset: { action: 'add' }, text: 'Add' }),
                ];
            },
        });
        button.click();
        popover()!.querySelector<HTMLButtonElement>('[data-action="add"]')!.focus();
        (document.activeElement as HTMLElement).blur();

        patterns.push('^#');
        holder.refresh();

        expect(document.activeElement).toBe(popover()!.querySelector('[data-action="add"]'));

        popover()!.querySelector<HTMLButtonElement>('[data-pattern="^#"] [data-action="edit"]')!.focus();
        patterns.splice(0, 1, '^//');
        holder.refresh();

        // A control that is gone hands focus to the one now in its place.
        expect(document.activeElement).toBe(popover()!.querySelector('[data-pattern="^//"] [data-action="edit"]'));
    });

    it('puts focus back on the last control it had once focus was lost, such as after a dialog', () => {
        const { button, refresh } = setUp();
        button.click();
        controls()[3]!.focus();
        (document.activeElement as HTMLElement).blur();

        refresh();

        expect(document.activeElement).toBe(controls()[3]);
    });

    it('stays open under the new button when the diff draws again for the same owner', () => {
        const owner = {};
        const first = setUp({ owner });
        first.button.click();
        const element = popover();
        controls()[2]!.focus();

        const second = setUp({ owner });

        expect(popover()).toBe(element);
        expect(second.builds).toHaveBeenCalledTimes(1);
        expect(second.button.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(controls()[2]);

        second.button.click();
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(second.button);
    });

    it('closes when another diff draws its button', () => {
        const first = setUp({ owner: {} });
        first.button.click();

        setUp({ owner: {} });

        expect(popover()).toBeNull();
        expect(first.button.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes once its button leaves the page, such as when another tab is shown', async () => {
        const { button } = setUp({ owner: {} });
        button.click();

        button.remove();
        await flushAsync();

        expect(popover()).toBeNull();
    });

    it('fits a narrow window, below its button', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 640);
        const { button } = setUp();
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 200, right: 300, top: 60, bottom: 90, width: 100, height: 30, x: 200, y: 60 } as DOMRect);

        button.click();

        const style = popover()!.style;
        expect(style.width).toBe('344px');
        expect(style.left).toBe('8px');
        expect(style.top).toBe('94px');
        expect(style.getPropertyValue('--diff-popover-room')).toBe('538px');
    });
});
