import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_MIME } from '../explorer/dragDrop.js';
import { renderDiffTargetDropZone, type DiffDropTarget, type DiffTargetDropZoneOptions } from './diffTargetDropZone.js';
import { flushAsync } from '../testing/testHelpers.js';

afterEach(() => {
    document.body.replaceChildren();
});

function mountZone(overrides: Partial<DiffTargetDropZoneOptions> = {}): { zone: HTMLElement; targets: DiffDropTarget[] } {
    const targets: DiffDropTarget[] = [];
    const zone = renderDiffTargetDropZone({
        onTarget: (target) => targets.push(target),
        onPickFileAsync: async () => null,
        ...overrides,
    });
    document.body.append(zone);

    return { zone, targets };
}

function withProperty<T extends Event>(event: T, name: string, value: unknown): T {
    Object.defineProperty(event, name, { value });

    return event;
}

function dropEvent(dataTransfer: unknown): Event {
    return withProperty(new Event('drop', { bubbles: true, cancelable: true }), 'dataTransfer', dataTransfer);
}

describe('renderDiffTargetDropZone', () => {
    it('spells out every way to provide the other side', () => {
        const { zone } = mountZone();

        expect(zone.getAttribute('role')).toBe('button');
        expect(zone.getAttribute('aria-label')).toContain('Drop a file here');
        expect(zone.textContent).toContain('Choose what to compare with');
        expect(zone.querySelectorAll('li')).toHaveLength(4);
    });

    it('opens the file picker on click', async () => {
        const picked: DiffDropTarget = { kind: 'disk', path: 'other.txt', text: 'other', file: null };
        const onPickFileAsync = vi.fn(async () => picked);
        const { zone, targets } = mountZone({ onPickFileAsync });

        zone.click();
        await flushAsync();

        expect(onPickFileAsync).toHaveBeenCalledOnce();
        expect(targets).toEqual([picked]);
    });

    it('delivers pasted text as a clipboard target', () => {
        const { zone, targets } = mountZone();
        const clipboardData = {
            files: [],
            getData: (type: string) => (type === 'text/plain' ? 'pasted text' : ''),
        };

        zone.dispatchEvent(withProperty(new Event('paste', { bubbles: true, cancelable: true }), 'clipboardData', clipboardData));

        expect(targets).toHaveLength(1);
        expect(targets[0]?.kind).toBe('clipboard');
        expect(targets[0]?.text).toBe('pasted text');
    });

    it('delivers a file dropped from the desktop', async () => {
        const { zone, targets } = mountZone();
        const file = new File(['a,b\n1,2'], 'rows.csv', { type: 'text/csv' });
        const outerDrop = vi.fn();
        document.body.addEventListener('drop', outerDrop);

        const event = dropEvent({ types: ['Files'], files: [file], getData: () => '' });
        zone.dispatchEvent(event);
        await flushAsync();

        expect(event.defaultPrevented).toBe(true);
        expect(outerDrop).not.toHaveBeenCalled();
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ kind: 'disk', path: 'rows.csv', text: 'a,b\n1,2', file });
        document.body.removeEventListener('drop', outerDrop);
    });

    it('reads the workspace path dropped from the Explorer tree', async () => {
        const readWorkspaceFileAsync = vi.fn(async (path: string): Promise<DiffDropTarget> => ({
            kind: 'file',
            path,
            text: 'from tree',
            file: null,
        }));
        const { zone, targets } = mountZone({ readWorkspaceFileAsync });

        zone.dispatchEvent(dropEvent({
            types: [INTERNAL_MIME],
            files: [],
            getData: (type: string) => (type === INTERNAL_MIME ? JSON.stringify(['docs/notes.md']) : ''),
        }));
        await flushAsync();

        expect(readWorkspaceFileAsync).toHaveBeenCalledWith('docs/notes.md');
        expect(targets[0]?.text).toBe('from tree');
    });

    it('marks the zone while a file is dragged over it', () => {
        const { zone } = mountZone();

        zone.dispatchEvent(withProperty(new Event('dragover', { bubbles: true, cancelable: true }), 'dataTransfer', {
            types: ['Files'],
            dropEffect: 'none',
        }));

        expect(zone.dataset['dragOver']).toBe('true');
    });
});
