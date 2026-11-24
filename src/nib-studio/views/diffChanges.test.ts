import { describe, expect, it } from 'vitest';
import type { DiffChange } from '../../common/diff/diffDocument.js';
import { navigationChangesOf } from './diffChanges.js';

const CHANGES: ReadonlyArray<DiffChange> = [
    { id: 'added', kind: 'added', location: {} },
    { id: 'gone', kind: 'removed', location: {} },
    { id: 'price', kind: 'changed', location: {} },
    { id: 'type', kind: 'typeChanged', location: {} },
];

describe('navigationChangesOf', () => {
    it('keeps the order, shows an addition on the modified side, a removal on the original, and any other change on both', () => {
        const changes = navigationChangesOf(CHANGES, { locate: () => [], labelled: true });

        expect(changes.map((change) => `${change.id}:${change.sides}:${change.label}`)).toEqual([
            'added:modified:added',
            'gone:original:gone',
            'price:both:price',
            'type:both:type',
        ]);
    });

    it('leaves the label out when asked, and finds the elements of a change through the locator', () => {
        const element = document.createElement('div');
        const changes = navigationChangesOf(CHANGES, { locate: (change) => change.id === 'gone' ? [element] : [], labelled: false });

        expect(changes[0]?.label).toBeUndefined();
        expect(changes[1]?.locate()).toEqual([element]);
        expect(changes[2]?.locate()).toEqual([]);
    });
});
