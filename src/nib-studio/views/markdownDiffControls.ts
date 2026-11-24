
const STORAGE_KEY = 'md-diff-view';
const VIEWS: ReadonlyArray<string> = Object.freeze(['diff', 'before', 'after']);
const LOUPE_ZOOM = 2.5;
const FLASH_MS = 1600;
const POSITION_HOLD_MS = 1000;
const COPIED_MS = 1200;
const BLOB_URL_LIFETIME_MS = 60_000;

// Drives the Diff / Before / After bar, change stepping and the side-by-side modal
// of a rendered Markdown diff from the parent page. The diff frame stays sandboxed
// without `allow-scripts`; the parent reaches its document through `allow-same-origin`.
// Elements live in the frame's realm, so this code avoids `instanceof` checks,
// and timers run on the parent window because the frame cannot run scripts.
export interface MarkdownDiffControlsOptions {
    // View to open on, instead of the last one used anywhere.
    readonly initialView?: string;
    readonly onViewChange?: (view: string) => void;
}

export function attachMarkdownDiffControls(frameDocument: Document, options?: MarkdownDiffControlsOptions): void {
    const frameWindow = frameDocument.defaultView;
    const bar = frameDocument.querySelector<HTMLElement>('.md-bar');
    const modal = frameDocument.querySelector<HTMLElement>('.md-modal');

    if (frameWindow == null || bar == null || modal == null) {
        return;
    }

    applyChromeText(frameDocument);

    const root = frameDocument.documentElement;
    const position = bar.querySelector<HTMLElement>('.md-pos');
    const sideBefore = modal.querySelector<HTMLElement>('.md-side-before');
    const sideAfter = modal.querySelector<HTMLElement>('.md-side-after');
    const lens = modal.querySelector<HTMLElement>('.md-lens');
    const loupe = modal.querySelector<HTMLElement>('.md-loupe');
    const listed = new Set(Array.from(
        frameDocument.querySelectorAll('.md-nav a'),
        (link) => (link.getAttribute('href') ?? '').slice(1),
    ));
    const changes = Array
        .from(frameDocument.querySelectorAll<HTMLElement>('.md-body [id^="chg"]'))
        .filter((element) => listed.has(element.id));
    let focused: HTMLElement | null = null;
    let movedAt = 0;
    let shown = -1;
    let lensImage: HTMLImageElement | null = null;
    let pointer: { x: number; y: number } | null = null;
    let scrollPending = false;

    const isVisible = (element: Element): boolean => element.getClientRects().length > 0;

    const inViewport = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();

        return rect.bottom > 0 && rect.top < frameWindow.innerHeight;
    };

    const visibleChanges = (): HTMLElement[] => changes.filter(isVisible);

    const currentIndex = (list: ReadonlyArray<HTMLElement>): number => {
        if (focused != null && (inViewport(focused) || Date.now() - movedAt < POSITION_HOLD_MS)) {
            const at = list.indexOf(focused);

            if (at >= 0) {
                return at;
            }
        }

        const middle = frameWindow.innerHeight / 2;
        let found = -1;

        for (let index = 0; index < list.length; index += 1) {
            const element = list[index];

            if (element == null || element.getBoundingClientRect().top > middle) {
                break;
            }

            found = index;
        }

        return found;
    };

    const updatePosition = (): void => {
        if (position == null) {
            return;
        }

        const list = visibleChanges();
        const at = currentIndex(list);
        position.textContent = `${at < 0 ? '–' : at + 1} / ${list.length}`;
    };

    const flash = (element: HTMLElement): void => {
        element.classList.remove('md-flash');
        void element.offsetWidth;
        element.classList.add('md-flash');
        window.setTimeout(() => element.classList.remove('md-flash'), FLASH_MS);
    };

    const moveTo = (element: HTMLElement, smooth: boolean): void => {
        focused = element;
        movedAt = Date.now();
        element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
        flash(element);
        updatePosition();
    };

    const step = (direction: number): void => {
        const list = visibleChanges();

        if (list.length === 0) {
            return;
        }

        const at = currentIndex(list);
        let target = at + direction;
        const current = list[at];

        if (direction < 0 && current != null && !inViewport(current)) {
            target = at;
        }

        const next = list[Math.max(0, Math.min(list.length - 1, target))];

        if (next != null) {
            moveTo(next, true);
        }
    };

    const setView = (requested: string): void => {
        const view = VIEWS.includes(requested) ? requested : 'diff';
        const anchor = frameDocument.elementFromPoint(frameWindow.innerWidth / 2, Math.min(120, frameWindow.innerHeight / 3));
        const anchorTop = anchor?.getBoundingClientRect().top ?? 0;

        for (const name of VIEWS) {
            frameDocument.body.classList.toggle(`md-v-${name}`, name === view);
        }

        if (anchor != null && isVisible(anchor)) {
            frameWindow.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
        }

        for (const button of bar.querySelectorAll('[data-view]')) {
            button.setAttribute('aria-pressed', String(button.getAttribute('data-view') === view));
        }

        if (options?.onViewChange != null) {
            options.onViewChange(view);
        }
        else {
            try {
                localStorage.setItem(STORAGE_KEY, view);
            }
            catch {
                // Storage can be unavailable; the view still switches.
            }
        }

        updatePosition();
    };

    const itemNumber = (item: HTMLElement): number => {
        const parent = item.parentElement as HTMLOListElement | null;
        let number = parent?.start ?? 1;

        for (let sibling = item.previousElementSibling; sibling != null; sibling = sibling.previousElementSibling) {
            if (sibling.tagName === 'LI') {
                number += 1;
            }
        }

        return number;
    };

    const fill = (side: HTMLElement | null, element: HTMLElement, placeholder: string): void => {
        if (side == null) {
            return;
        }

        side.replaceChildren();

        if (placeholder !== '') {
            const empty = frameDocument.createElement('div');
            empty.className = 'md-empty';
            empty.textContent = placeholder;
            side.append(empty);

            return;
        }

        let clone = element.cloneNode(true) as HTMLElement;
        clone.removeAttribute('id');
        clone.classList.remove('md-flash');

        for (const input of clone.querySelectorAll('input')) {
            input.remove();
        }

        for (const withId of clone.querySelectorAll('[id]')) {
            withId.removeAttribute('id');
        }

        if (element.tagName === 'LI') {
            for (const child of Array.from(clone.children)) {
                if (child.tagName === 'UL' || child.tagName === 'OL') {
                    child.remove();
                }
            }

            const list = frameDocument.createElement(element.parentElement?.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul');

            if (list.tagName === 'OL') {
                (list as HTMLOListElement).start = itemNumber(element);
            }

            list.append(clone);
            clone = list;
        }

        side.append(clone);
    };

    const hideLens = (): void => {
        if (lens != null) {
            lens.hidden = true;
        }

        lensImage = null;
    };

    const placeLens = (target: Element | null, x: number, y: number): void => {
        const image = modal.classList.contains('md-loupe-on')
            ? target?.closest<HTMLImageElement>('.md-side .md-diagram img') ?? null
            : null;

        if (image == null || lens == null) {
            hideLens();

            return;
        }

        if (image !== lensImage) {
            lensImage = image;
            lens.style.backgroundImage = `url("${image.src}")`;
            lens.hidden = false;
        }

        const rect = image.getBoundingClientRect();
        lens.style.left = `${x - lens.offsetWidth / 2}px`;
        lens.style.top = `${y - lens.offsetHeight / 2}px`;
        lens.style.backgroundSize = `${rect.width * LOUPE_ZOOM}px ${rect.height * LOUPE_ZOOM}px`;
        lens.style.backgroundPosition = `${lens.clientWidth / 2 - (x - rect.left) * LOUPE_ZOOM}px ${lens.clientHeight / 2 - (y - rect.top) * LOUPE_ZOOM}px`;
    };

    const toggleLoupe = (): void => {
        loupe?.setAttribute('aria-pressed', String(modal.classList.toggle('md-loupe-on')));
    };

    const openAt = (index: number): void => {
        const element = changes[index];

        if (element == null) {
            return;
        }

        shown = index;
        hideLens();

        if (loupe != null) {
            loupe.hidden = !element.classList.contains('md-diagram');
        }

        fill(sideBefore, element, element.classList.contains('md-blk-add') ? 'Not in the original' : '');
        fill(sideAfter, element, element.classList.contains('md-blk-del') ? 'Not in the revision' : '');

        const link = frameDocument.querySelector(`.md-nav a[href="#${element.id}"]`);
        const section = link?.closest('.md-sec')?.querySelector('.md-sec-h')?.textContent ?? '';
        const sectionLabel = modal.querySelector('.md-modal-sec');
        const linkLabel = modal.querySelector('.md-modal-l');
        const positionLabel = modal.querySelector('.md-modal-pos');
        const previous = modal.querySelector<HTMLButtonElement>('[data-move="-1"]');
        const next = modal.querySelector<HTMLButtonElement>('[data-move="1"]');

        if (sectionLabel != null) {
            sectionLabel.textContent = section;
        }

        if (linkLabel != null) {
            linkLabel.replaceChildren(...Array.from(link?.childNodes ?? [], (node) => node.cloneNode(true)));
        }

        if (positionLabel != null) {
            positionLabel.textContent = `${index + 1} / ${changes.length}`;
        }

        if (previous != null) {
            previous.disabled = index === 0;
        }

        if (next != null) {
            next.disabled = index === changes.length - 1;
        }

        if (sideBefore != null) {
            sideBefore.scrollTop = 0;
        }

        if (sideAfter != null) {
            sideAfter.scrollTop = 0;
        }

        if (modal.hidden) {
            modal.hidden = false;
            root.classList.add('md-locked');
        }
    };

    const closeModal = (): void => {
        hideLens();
        modal.hidden = true;
        root.classList.remove('md-locked');
        const element = changes[shown];

        if (element == null || !isVisible(element)) {
            return;
        }

        if (inViewport(element)) {
            focused = element;
            flash(element);
            updatePosition();

            return;
        }

        moveTo(element, false);
    };

    const copySource = (button: Element): void => {
        const encoded = button.getAttribute('data-src') ?? '';
        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const label = button.textContent;

        void (async () => {
            try {
                await navigator.clipboard.writeText(new TextDecoder().decode(bytes));
                button.textContent = 'Copied';
            }
            catch {
                button.textContent = 'Copy failed';
            }

            window.setTimeout(() => {
                button.textContent = label;
            }, COPIED_MS);
        })();
    };

    // Opens the diagram image in a new tab without fetching it.
    const enlarge = (button: Element): void => {
        const image = button.closest('.md-pane, .md-diff, .md-mermaid')?.querySelector<HTMLImageElement>('img');
        const blob = image == null ? null : dataUrlToBlob(image.src);

        if (blob != null) {
            openBlobInNewTab(blob);
        }
    };

    const followLink = (event: MouseEvent, link: HTMLAnchorElement): void => {
        const href = link.getAttribute('href') ?? '';
        event.preventDefault();

        if (href.startsWith('#')) {
            const element = frameDocument.getElementById(decodeURIComponent(href.slice(1)));

            if (element != null && changes.includes(element)) {
                moveTo(element, true);
            }
            else {
                element?.scrollIntoView({ block: 'start' });
            }

            return;
        }

        // Links leave the sandboxed frame only as a new tab the user asked for.
        if (/^https?:\/\//i.test(href)) {
            window.open(href, '_blank', 'noopener');
        }
    };

    const onClick = (event: MouseEvent): void => {
        const target = event.target as Element | null;

        if (target == null || typeof target.closest !== 'function') {
            return;
        }

        const copy = target.closest('.md-copy');

        if (copy != null) {
            copySource(copy);

            return;
        }

        const enlargeButton = target.closest('.md-enlarge');

        if (enlargeButton != null) {
            enlarge(enlargeButton);

            return;
        }

        if (!modal.hidden) {
            const move = target.closest('[data-move]');

            if (target.closest('.md-loupe') != null) {
                toggleLoupe();
            }
            else if (move != null) {
                openAt(shown + Number(move.getAttribute('data-move')));
            }
            else if (target === modal || target.closest('.md-modal-x') != null) {
                closeModal();
            }

            return;
        }

        const view = target.closest('[data-view]');

        if (view != null) {
            setView(view.getAttribute('data-view') ?? 'diff');

            return;
        }

        const stepButton = target.closest('[data-step]');

        if (stepButton != null) {
            step(Number(stepButton.getAttribute('data-step')));

            return;
        }

        if (target.closest('.md-review') != null) {
            const list = visibleChanges();
            const at = currentIndex(list);
            const current = list[at];
            openAt(current != null ? changes.indexOf(current) : 0);

            return;
        }

        const link = target.closest<HTMLAnchorElement>('a[href]');

        if (link != null) {
            followLink(event, link);

            return;
        }

        const block = target.closest<HTMLElement>('.md-body [id^="chg"]');

        if (block == null || target.closest('button, label, input') != null || String(frameWindow.getSelection()) !== '') {
            return;
        }

        openAt(changes.indexOf(block));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (!modal.hidden) {
            const actions: Readonly<Record<string, () => void>> = {
                Escape: closeModal,
                ArrowLeft: () => openAt(shown - 1),
                ArrowRight: () => openAt(shown + 1),
            };
            const action = actions[event.key];

            if (action != null) {
                action();
                event.preventDefault();
            }

            return;
        }

        const tagName = (event.target as Element | null)?.tagName ?? '';

        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
            return;
        }

        if (event.key === 'n') {
            step(1);
        }

        if (event.key === 'p') {
            step(-1);
        }
    };

    frameDocument.addEventListener('click', onClick);
    frameDocument.addEventListener('keydown', onKeyDown);
    modal.addEventListener('mousemove', (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        placeLens(event.target as Element | null, event.clientX, event.clientY);
    });
    modal.addEventListener('mouseout', (event) => {
        if (event.relatedTarget == null) {
            hideLens();
        }
    });
    modal.addEventListener('scroll', () => {
        if (pointer != null) {
            placeLens(frameDocument.elementFromPoint(pointer.x, pointer.y), pointer.x, pointer.y);
        }
    }, true);
    frameWindow.addEventListener('scroll', () => {
        if (scrollPending) {
            return;
        }

        scrollPending = true;
        window.requestAnimationFrame(() => {
            scrollPending = false;
            updatePosition();
        });
    }, { passive: true });

    if (changes.length === 0) {
        bar.classList.add('md-bar-empty');
    }

    let saved: string | null = options?.initialView ?? null;

    try {
        saved ??= localStorage.getItem(STORAGE_KEY);
    }
    catch {
        saved = null;
    }

    setView(saved ?? 'diff');
}

interface ChromeText {
    readonly selector: string;
    readonly text?: string;
    readonly title?: string;
    readonly ariaLabel?: string;
}

const BEFORE_TEXT = 'Before';
const AFTER_TEXT = 'After';

// Labels and tooltips the parent applies over the generated diff page controls.
const CHROME_TEXTS: ReadonlyArray<ChromeText> = Object.freeze([
    { selector: '.md-bar', ariaLabel: 'Diff view' },
    {
        selector: '.md-bar [data-view="diff"]',
        text: 'Diff',
        title: 'Insertions and deletions',
    },
    {
        selector: '.md-bar [data-view="before"]',
        text: BEFORE_TEXT,
        title: 'Read the original',
    },
    {
        selector: '.md-bar [data-view="after"]',
        text: AFTER_TEXT,
        title: 'Read the revision',
    },
    { selector: '.md-bar [data-step="-1"]', title: 'Previous change (p)' },
    { selector: '.md-bar [data-step="1"]', title: 'Next change (n)' },
    { selector: '.md-review', title: 'Compare side by side (or click any change)' },
    { selector: '.md-modal-box', ariaLabel: 'Side-by-side compare' },
    { selector: '.md-loupe', title: 'Magnify the diagram under the cursor' },
    { selector: '.md-modal [data-move="-1"]', title: 'Previous change (←)' },
    { selector: '.md-modal [data-move="1"]', title: 'Next change (→)' },
    { selector: '.md-modal-x', title: 'Close (Esc)' },
    { selector: '.md-modal-col:first-child .md-modal-ch', text: BEFORE_TEXT },
    { selector: '.md-modal-col:last-child .md-modal-ch', text: AFTER_TEXT },
    { selector: '.md-tabbar label:first-child', text: BEFORE_TEXT },
    { selector: '.md-tabbar label:last-child', text: AFTER_TEXT },
    { selector: '.md-enlarge', text: '🔍 Enlarge' },
]);

function applyChromeText(frameDocument: Document): void {
    for (const entry of CHROME_TEXTS) {
        for (const element of frameDocument.querySelectorAll(entry.selector)) {
            if (entry.text != null) {
                element.textContent = entry.text;
            }

            if (entry.title != null) {
                element.setAttribute('title', entry.title);
            }

            if (entry.ariaLabel != null) {
                element.setAttribute('aria-label', entry.ariaLabel);
            }
        }
    }

    for (const copy of frameDocument.querySelectorAll('.md-copy')) {
        const isMermaid = (copy.textContent ?? '').toLowerCase().includes('mermaid');
        copy.textContent = isMermaid
            ? '📋 Copy Mermaid'
            : '📋 Copy table';
    }

    const navHeading = frameDocument.querySelector('.md-nav-h');
    const count = frameDocument.querySelectorAll('.md-nav a').length;

    if (navHeading != null) {
        navHeading.textContent = `Changes (${count})`;
    }
}

// Opens a blob, such as a diagram image, in a new tab and frees the URL once the tab has loaded it.
export function openBlobInNewTab(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
}

function dataUrlToBlob(url: string): Blob | null {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);

    if (match == null) {
        return null;
    }

    const [, type, base64, payload] = match;
    const bytes = base64 != null
        ? Uint8Array.from(atob(payload ?? ''), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(payload ?? ''));

    return new Blob([bytes], { type });
}
