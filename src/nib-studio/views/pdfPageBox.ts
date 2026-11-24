import { h } from '../app/dom.js';

export interface PageBox {
    readonly element: HTMLElement;
    setCount(count: number): void;
    // Shows the page being read, unless the box is being typed in.
    setCurrent(index: number): void;
}

// The page index typed in the box, kept within the document; null for anything that isn't a whole number.
export function parsePageNumber(text: string, pageCount: number): number | null {
    const trimmed = text.trim();

    if (!/^\d+$/.test(trimmed) || pageCount <= 0) {
        return null;
    }

    return Math.min(pageCount, Math.max(1, Number(trimmed))) - 1;
}

// "3 / 12" in the toolbar: it follows the scroll, and a page number typed in it and Enter go to that page.
export function createPageBox(options: { readonly onGo: (index: number) => void }): PageBox {
    let count = 0;
    let current = 0;
    const input = h('input', {
        class: 'pdf-page-input',
        attrs: {
            type: 'text',
            inputmode: 'numeric',
            autocomplete: 'off',
            spellcheck: 'false',
            size: 1,
            value: '',
            title: 'Type a page number and press Enter to go to it',
            'aria-label': 'Page number',
            disabled: true,
        },
    });
    const total = h('span', { class: 'pdf-page-count', text: '/ 0' });
    const element = h('div', {
        class: 'toolbar-group pdf-page-box',
        attrs: { role: 'group', 'aria-label': 'Page', hidden: true },
        children: [input, total],
    });

    const showCurrent = (): void => {
        input.value = count > 0 ? String(current + 1) : '';
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const index = parsePageNumber(input.value, count);

            if (index != null) {
                current = index;
                options.onGo(index);
            }

            showCurrent();
            input.select();

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            showCurrent();
            input.select();
        }
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', showCurrent);

    return {
        element,
        setCount: (next) => {
            count = next;
            current = Math.min(current, Math.max(0, next - 1));
            total.textContent = `/ ${next.toLocaleString('en-US')}`;
            // Wide enough for the longest page number.
            input.size = Math.max(1, String(next).length);
            input.disabled = next <= 0;
            // Without a document, such as while a password is asked for, there is no page to show.
            element.hidden = next <= 0;
            showCurrent();
        },
        setCurrent: (index) => {
            current = index;

            if (document.activeElement !== input) {
                showCurrent();
            }
        },
    };
}
