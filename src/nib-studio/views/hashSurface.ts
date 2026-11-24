import { clear, h } from '../app/dom.js';
import { buildCodecCard } from './codecCard.js';
import { buildHashCard, hashTextAsync } from './hashCard.js';
import { createHashSurfaceState } from './hashSurfaceState.js';
import { buildHmacCard } from './hmacCard.js';
import { buildJwtCard } from './jwtCard.js';
import type { ToolCard, ToolCardContext } from './toolCard.js';
import { buildVerifyCard } from './verifyCard.js';

// The Hash & encode surface: Hash, Verify, HMAC, Encode / Decode and JWT decode cards in a grid.
// It is drawn again whenever it comes back from the Files surface, so the inputs live here, for the life of the tab only.

const state = createHashSurfaceState();
const mounted: { cards: ReadonlyArray<ToolCard>; element: HTMLElement | null; isPrimed: boolean } = {
    cards: [],
    element: null,
    isPrimed: false,
};

const context: ToolCardContext = {
    state,
    refresh: () => {
        for (const card of mounted.cards) {
            card.update();
        }
    },
};

const CARD_BUILDERS: ReadonlyArray<(context: ToolCardContext) => ToolCard> = [
    buildHashCard,
    buildVerifyCard,
    buildHmacCard,
    buildCodecCard,
    buildJwtCard,
];

// Renders that find the surface still on screen leave it as it is, so a box keeps focus and caret.
export function renderHashSurface(container: HTMLElement): void {
    if (
        mounted.element != null
        && mounted.element.parentElement === container
        && container.childElementCount === 1
    ) {
        return;
    }

    clear(container);
    const cards = CARD_BUILDERS.map((build) => build(context));
    mounted.cards = cards;
    mounted.element = h('div', { class: 'hash-surface', children: cards.map((card) => card.element) });
    container.append(mounted.element);
    context.refresh();

    // The sample text's digests show on first view, before any Enter.
    if (!mounted.isPrimed) {
        mounted.isPrimed = true;
        void hashTextAsync(context);
    }
}
