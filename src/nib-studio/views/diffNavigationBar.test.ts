import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    attachDiffNavigation,
    compareSize,
    createDiffNavigationState,
    isShownInView,
    scheduleDiffRender,
    setCurrentChange,
    type DiffChangeSides,
    type DiffNavigation,
    type DiffNavigationChange,
    type DiffNavigationOptions,
    type DiffNavigationState,
} from './diffNavigationBar.js';
import { pressKey } from '../testing/testHelpers.js';

interface Fixture {
    readonly host: HTMLElement;
    readonly scroller: HTMLElement;
    readonly rows: HTMLElement[];
    readonly changes: DiffNavigationChange[];
    readonly state: DiffNavigationState;
}

const SIDES: ReadonlyArray<DiffChangeSides> = ['both', 'modified', 'original', 'both'];

function buildFixture(sides: ReadonlyArray<DiffChangeSides> = SIDES): Fixture {
    const host = document.createElement('div');
    const scroller = document.createElement('div');
    const rows = sides.map((_, index) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.textContent = `change ${index}`;

        return row;
    });
    scroller.append(...rows);
    host.append(scroller);
    document.body.append(host);

    return {
        host,
        scroller,
        rows,
        changes: sides.map((side, index) => ({ id: `c${index}`, sides: side, label: `path ${index}`, locate: () => [rows[index]!] })),
        state: createDiffNavigationState(),
    };
}

function attach(fixture: Fixture, overrides: Partial<DiffNavigationOptions> = {}): DiffNavigation {
    return attachDiffNavigation({
        host: fixture.host,
        scroller: fixture.scroller,
        keyScope: fixture.host,
        state: fixture.state,
        rowSelector: '.row',
        changes: () => fixture.changes,
        ...overrides,
    });
}

function position(fixture: Fixture): string {
    return fixture.host.querySelector('.diff-bar-position')?.textContent ?? '';
}

function click(fixture: Fixture, selector: string): void {
    fixture.host.querySelector<HTMLButtonElement>(`.diff-bar ${selector}`)!.click();
}

describe('attachDiffNavigation', () => {
    let scrollIntoView: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it('floats Diff, Before and After, the position and Previous / Next, with the Markdown diff tooltips', () => {
        const fixture = buildFixture();
        const navigation = attach(fixture);

        expect(fixture.host.lastElementChild).toBe(navigation.bar);
        expect(fixture.host.classList.contains('diff-bar-host')).toBe(true);
        expect(navigation.bar.getAttribute('role')).toBe('toolbar');
        const views = Array.from(navigation.bar.querySelectorAll<HTMLElement>('[data-view]'), (button) => [button.textContent, button.title, button.getAttribute('aria-pressed')]);
        expect(views).toEqual([
            ['Diff', 'Insertions and deletions', 'true'],
            ['Before', 'Read the original', 'false'],
            ['After', 'Read the revision', 'false'],
        ]);
        const steps = Array.from(navigation.bar.querySelectorAll<HTMLElement>('[data-step]'), (button) => [button.textContent, button.title, button.getAttribute('aria-label')]);
        expect(steps).toEqual([
            ['↑', 'Previous change (p)', 'Previous change'],
            ['↓', 'Next change (n)', 'Next change'],
        ]);
        expect(position(fixture)).toBe('– / 4');
    });

    it('steps forward and back, scrolling each change to the centre and flashing it, and stops at either end', () => {
        vi.useFakeTimers();
        const fixture = buildFixture();
        attach(fixture);

        click(fixture, '[data-step="1"]');
        expect(position(fixture)).toBe('1 / 4');
        expect(fixture.state.current).toBe('c0');
        expect(fixture.rows[0]?.dataset['flash']).toBe('true');
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });

        for (let index = 0; index < 5; index += 1) {
            click(fixture, '[data-step="1"]');
        }

        expect(position(fixture)).toBe('4 / 4');

        click(fixture, '[data-step="-1"]');
        expect(position(fixture)).toBe('3 / 4');

        for (let index = 0; index < 5; index += 1) {
            click(fixture, '[data-step="-1"]');
        }

        expect(position(fixture)).toBe('1 / 4');
        vi.advanceTimersByTime(1700);
        expect(fixture.rows.some((row) => row.dataset['flash'] != null)).toBe(false);
    });

    it('counts and steps only the changes the chosen view shows', () => {
        const fixture = buildFixture();
        attach(fixture);

        click(fixture, '[data-view="before"]');
        expect(fixture.host.dataset['diffView']).toBe('before');
        expect(fixture.state.view).toBe('before');
        expect(fixture.host.querySelector('[data-view="before"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(fixture.host.querySelector('[data-view="diff"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(position(fixture)).toBe('– / 3');

        click(fixture, '[data-step="1"]');
        click(fixture, '[data-step="1"]');
        expect(fixture.state.current).toBe('c2');

        click(fixture, '[data-view="after"]');
        expect(position(fixture)).toBe('– / 3');
        click(fixture, '[data-step="1"]');
        click(fixture, '[data-step="1"]');
        expect(fixture.state.current).toBe('c1');
    });

    it('steps with n, p and the arrow keys, but not while typing or with a modifier', () => {
        const fixture = buildFixture();
        const input = document.createElement('input');
        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        fixture.host.append(input, editable);
        attach(fixture);

        expect(pressKey(fixture.scroller, 'n').defaultPrevented).toBe(true);
        pressKey(fixture.scroller, 'ArrowDown');
        expect(position(fixture)).toBe('2 / 4');
        pressKey(fixture.scroller, 'p');
        pressKey(fixture.scroller, 'ArrowUp');
        expect(position(fixture)).toBe('1 / 4');

        pressKey(input, 'n');
        pressKey(editable, 'ArrowDown');
        pressKey(fixture.scroller, 'n', { ctrlKey: true });
        expect(position(fixture)).toBe('1 / 4');
    });

    it('leaves keys another control already handled, such as the differences list arrows', () => {
        const fixture = buildFixture();
        const list = document.createElement('ul');
        list.addEventListener('keydown', (event) => event.preventDefault());
        fixture.host.append(list);
        attach(fixture);

        pressKey(list, 'ArrowDown');

        expect(position(fixture)).toBe('– / 4');
    });

    it('names the current change in the position tooltip', () => {
        const fixture = buildFixture();
        attach(fixture);

        click(fixture, '[data-step="1"]');

        expect(fixture.host.querySelector('.diff-bar-position')?.getAttribute('title')).toBe('path 0');
    });

    it('makes a change clicked in the diff the current one, but not a click on a control or outside a change', () => {
        const fixture = buildFixture();
        const button = document.createElement('button');
        fixture.rows[2]!.append(button);
        const outside = document.createElement('div');
        fixture.scroller.append(outside);
        const onMove = vi.fn();
        attach(fixture, { onMove });

        fixture.rows[1]!.click();
        expect(fixture.state.current).toBe('c1');
        expect(position(fixture)).toBe('2 / 4');
        expect(onMove).toHaveBeenCalledWith(fixture.changes[1]);

        button.click();
        outside.click();
        expect(fixture.state.current).toBe('c1');
    });

    it('offers Recompute when the view can compare again, showing progress until it does', async () => {
        vi.useFakeTimers();
        const fixture = buildFixture();
        const onRecompute = vi.fn();
        const navigation = attach(fixture, { onRecompute });
        const recompute = navigation.bar.querySelector<HTMLButtonElement>('[data-action="recompute"]')!;

        expect([recompute.textContent, recompute.title, recompute.getAttribute('aria-label')]).toEqual(['↻', 'Recompute', 'Recompute']);
        recompute.click();
        expect(position(fixture)).toBe('Comparing…');
        expect(navigation.bar.dataset['busy']).toBe('true');
        click(fixture, '[data-step="1"]');
        expect(fixture.state.current).toBeNull();

        await vi.advanceTimersByTimeAsync(100);
        expect(onRecompute).toHaveBeenCalledTimes(1);
    });

    it('leaves Recompute out when the view has none', () => {
        const fixture = buildFixture();

        expect(attach(fixture).bar.querySelector('[data-action="recompute"]')).toBeNull();
    });

    it('tells the view where it moved, and asks it to draw a change that is not drawn', () => {
        const fixture = buildFixture();
        const collapsed: DiffNavigationChange = { id: 'hidden', sides: 'both', locate: () => [] };
        fixture.changes.push(collapsed);
        const onMove = vi.fn();
        const onReveal = vi.fn();
        attach(fixture, { onMove, onReveal });

        click(fixture, '[data-step="1"]');
        expect(onMove).toHaveBeenCalledWith(fixture.changes[0]);

        fixture.state.current = 'c3';
        click(fixture, '[data-step="1"]');
        expect(onReveal).toHaveBeenCalledWith(collapsed);
        expect(fixture.state).toMatchObject({ current: 'hidden', reveal: true });
    });

    it('reveals the current change once drawn, switching to Diff when the chosen view leaves it out', () => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);

            return 0;
        });
        const fixture = buildFixture();
        fixture.state.view = 'before';
        setCurrentChange(fixture.state, 'c1', true);

        attach(fixture);

        expect(fixture.state.reveal).toBe(false);
        expect(fixture.state.view).toBe('diff');
        expect(fixture.rows[1]?.dataset['flash']).toBe('true');
        expect(position(fixture)).toBe('2 / 4');
    });

    it('keeps the chosen view and the current change for the next render', () => {
        const fixture = buildFixture();
        attach(fixture);
        click(fixture, '[data-view="after"]');
        click(fixture, '[data-step="1"]');
        fixture.host.replaceChildren(fixture.scroller);

        attach(fixture);

        expect(fixture.host.dataset['diffView']).toBe('after');
        expect(fixture.host.querySelector('[data-view="after"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(position(fixture)).toBe('1 / 3');
    });

    it('says there are no changes, hides stepping and leaves the keys alone', () => {
        const fixture = buildFixture([]);
        const navigation = attach(fixture);

        expect(navigation.bar.dataset['empty']).toBe('true');
        expect(position(fixture)).toBe('No changes');
        expect(pressKey(fixture.scroller, 'ArrowDown').defaultPrevented).toBe(false);
    });

    it('reads the position from the scroll when the current change has scrolled out of sight', () => {
        const fixture = buildFixture();
        const top = (element: Element): number => {
            const index = fixture.rows.indexOf(element as HTMLElement);

            return index < 0 ? 0 : index * 400 - fixture.scroller.scrollTop;
        };
        Object.defineProperty(fixture.scroller, 'clientHeight', { configurable: true, value: 300 });
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const at = this === fixture.scroller ? 0 : top(this);

            return { top: at, bottom: at + (this === fixture.scroller ? 300 : 20), left: 0, right: 100, width: 100, height: 20, x: 0, y: at } as DOMRect;
        });
        attach(fixture);

        fixture.scroller.scrollTop = 820;
        fixture.state.movedAt = 0;
        fixture.scroller.dispatchEvent(new Event('scroll'));
        click(fixture, '[data-step="1"]');

        expect(fixture.state.current).toBe('c3');
    });
});

describe('diff navigation helpers', () => {
    it('leaves out changes only the hidden side has', () => {
        expect(isShownInView('modified', 'before')).toBe(false);
        expect(isShownInView('original', 'after')).toBe(false);
        expect(isShownInView('both', 'before')).toBe(true);
        expect(isShownInView('original', 'diff')).toBe(true);
    });

    it('starts on Diff with no current change', () => {
        expect(createDiffNavigationState()).toEqual({ view: 'diff', current: null, movedAt: 0, reveal: false });
    });

    it('measures both sides by their text, or by the file when there is no text', () => {
        const file = new File(['x'], 'big.csv');
        Object.defineProperty(file, 'size', { value: 5000 });

        expect(compareSize({ label: 'a', source: 'paste', text: 'abc' }, { label: 'b', source: 'disk', file })).toBe(5003);
        expect(compareSize(null, null)).toBe(0);
    });

    it('marks a change current, and asks for a reveal when told to', () => {
        const state = createDiffNavigationState();

        setCurrentChange(state, 'items[0]', true);

        expect(state.current).toBe('items[0]');
        expect(state.reveal).toBe(true);
        expect(Date.now() - state.movedAt).toBeLessThan(1000);
    });
});

describe('scheduleDiffRender', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    function diffWithBar(): HTMLElement {
        const container = document.createElement('div');
        container.innerHTML = '<div class="diff-bar"><span class="diff-bar-position">1 / 2</span></div>';
        document.body.append(container);

        return container;
    }

    it('draws a small compare again at once', () => {
        const render = vi.fn();

        scheduleDiffRender(diffWithBar(), 10, render);

        expect(render).toHaveBeenCalledTimes(1);
    });

    it('waits on a large compare, showing progress in the bar, and compares once for quick successive changes', () => {
        vi.useFakeTimers();
        const container = diffWithBar();
        const render = vi.fn();

        scheduleDiffRender(container, 2_000_000, render);
        scheduleDiffRender(container, 2_000_000, render);

        expect(render).not.toHaveBeenCalled();
        expect(container.querySelector('.diff-bar-position')?.textContent).toBe('Comparing…');
        expect(container.querySelector('.diff-bar')?.getAttribute('aria-busy')).toBe('true');
        vi.advanceTimersByTime(400);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('leaves a diff that is no longer shown to compare when it is shown again', () => {
        vi.useFakeTimers();
        const container = diffWithBar();
        const render = vi.fn();

        scheduleDiffRender(container, 2_000_000, render);
        container.remove();
        vi.advanceTimersByTime(400);

        expect(render).not.toHaveBeenCalled();
    });
});

