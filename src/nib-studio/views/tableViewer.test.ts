import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXCEL_DEFAULT_PASSWORD } from '../../common/office/encryption/officeEncryption.js';
import {
    buildEncryptedWorkbook,
    buildStandardEncryptedAsync,
    buildTinyWorkbook,
    buildTinyXlsx,
    encryptedPackageFile,
    encryptionInfoStream,
} from '../../common/office/testing/encryptionFixtures.js';
import { readWorkbook } from '../../common/office/xlsxLoader.js';
import { settleAsync } from '../testing/testHelpers.js';
import { LargeCsvSource } from './largeCsvSource.js';

// Tables above this many bytes take the streaming path, so a few rows are enough to exercise it.
const SMALL_LARGE_TABLE_BYTES = 64;

vi.mock('../../common/office/xlsxLoader.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../common/office/xlsxLoader.js')>();

    return { ...original, readWorkbook: vi.fn(original.readWorkbook) };
});

vi.mock('../../common/csv/csvLimits.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../common/csv/csvLimits.js')>(),
    isLargeTableFile: (path: string, size: number) => /\.(csv|tsv)$/.test(path) && size > SMALL_LARGE_TABLE_BYTES,
}));

const { pruneTableMemories, renderTableViewerAsync, tableMemoryFor } = await import('./tableViewer.js');

function headers(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.table-workspace-main th .table-header-label')].map((cell) => cell.textContent ?? '');
}

describe('tableMemoryFor', () => {
    it('returns the same memory for a key until it is pruned', () => {
        const memory = tableMemoryFor('a.csv');
        memory.search = 'Ada';

        expect(tableMemoryFor('a.csv')).toBe(memory);
        pruneTableMemories(['a.csv']);
        expect(tableMemoryFor('a.csv')).toBe(memory);
        pruneTableMemories(['b.csv']);
        expect(tableMemoryFor('a.csv')).not.toBe(memory);
        expect(tableMemoryFor('a.csv')).toEqual({});
    });
});

describe('renderTableViewerAsync', () => {
    let container: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        container.append(document.createElement('span'));
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('clears what the container held, and leaves it empty for a file that is not a table', async () => {
        await renderTableViewerAsync(container, { fileName: 'a.json', text: '{}' });

        expect(container.childElementCount).toBe(0);
    });

    it('renders CSV text as a table with its header row as columns', async () => {
        await renderTableViewerAsync(container, { fileName: 'people.csv', text: 'name,age\nAda,36\nAlan,41\n' });
        await settleAsync();

        expect(headers(container)).toEqual(['name', 'age']);
        expect(container.textContent).toContain('Ada');
    });

    it('renders a CSV file handle as a table', async () => {
        const file = new File(['city\nParis\n'], 'cities.csv');

        await renderTableViewerAsync(container, { fileName: 'cities.csv', file, path: 'data/cities.csv' });
        await settleAsync();

        expect(headers(container)).toEqual(['city']);
    });

    it('reads a CSV file in a Windows code page as the editor does', async () => {
        // `πόλη` in Windows-1253, which isn't UTF-8.
        const file = new File([Uint8Array.of(0xf0, 0xfc, 0xeb, 0xe7, 0x0a, 0x41, 0x0a)], 'greek.csv');

        await renderTableViewerAsync(container, { fileName: 'greek.csv', file, path: 'data/greek.csv' });
        await settleAsync();

        expect(headers(container)).toEqual(['πόλη']);
    });

    it('shows an error card for a workbook without a file', async () => {
        await renderTableViewerAsync(container, { fileName: 'book.xlsx', text: '' });

        expect(container.querySelector('h2')?.textContent).toBe('Preview not available');
        expect(container.querySelector('p')?.textContent).toBe('An XLSX workbook requires a File handle.');
    });

    it('streams a CSV file over the size limit through the indexed source', async () => {
        const openAsync = vi.spyOn(LargeCsvSource, 'openAsync');
        const file = new File(['id,name\n1,Ada Lovelace\n2,Alan Turing\n3,Grace Hopper\n4,Edsger Dijkstra\n'], 'people.csv');

        await renderTableViewerAsync(container, { fileName: 'people.csv', file, path: 'data/people.csv' });
        await settleAsync();

        expect(openAsync).toHaveBeenCalledWith(file, 'people.csv');
        expect(headers(container)).toEqual(['id', 'name']);
        expect(container.querySelector('.table-row-badge')?.textContent).toBe('4 of 4 rows');
        openAsync.mockRestore();
    });

    it('reuses the indexed source when the same large file renders again', async () => {
        const openAsync = vi.spyOn(LargeCsvSource, 'openAsync');
        const file = new File([`city\n${'Athens\n'.repeat(20)}`], 'cities.csv');

        await renderTableViewerAsync(container, { fileName: 'cities.csv', file });
        await renderTableViewerAsync(container, { fileName: 'cities.csv', file });
        await settleAsync();

        expect(openAsync).toHaveBeenCalledTimes(1);
        expect(headers(container)).toEqual(['city']);
        openAsync.mockRestore();
    });

    it('keeps a CSV file under the size limit in memory', async () => {
        const openAsync = vi.spyOn(LargeCsvSource, 'openAsync');

        await renderTableViewerAsync(container, { fileName: 'tiny.csv', file: new File(['a\n1\n'], 'tiny.csv') });
        await settleAsync();

        expect(openAsync).not.toHaveBeenCalled();
        expect(container.querySelector('.table-row-badge')?.textContent).toBe('1 of 1 rows');
        openAsync.mockRestore();
    });

    it('renders the first sheet of a workbook, naming blank header cells by position', async () => {
        const file = new File(['xlsx'], 'book.xlsx');
        vi.mocked(readWorkbook).mockReturnValueOnce({
            sheets: [
                { name: 'People', hidden: false, rows: [['name', ''], ['Ada', 36], ['Alan', 41]] },
                { name: 'Other', hidden: false, rows: [['ignored']] },
            ],
        });

        await renderTableViewerAsync(container, { fileName: 'book.xlsx', file });
        await settleAsync();

        expect(readWorkbook).toHaveBeenCalledWith(new TextEncoder().encode('xlsx'));
        expect(headers(container)).toEqual(['name', 'Column 2']);
        expect(container.textContent).toContain('Alan');
        expect(container.textContent).not.toContain('ignored');
    });

    it('renders macro-enabled, template and binary Excel workbooks and OpenDocument spreadsheets as tables', async () => {
        for (const [fileName, bookType] of [
            ['book.xlsm', 'xlsm'],
            ['template.xltx', 'xlsx'],
            ['template.xltm', 'xlsm'],
            ['book.xlsb', 'xlsb'],
            ['book.ods', 'ods'],
        ] as const) {
            const file = new File([buildTinyWorkbook([['name', 'age'], ['Ada', 36]], bookType).slice()], fileName);

            await renderTableViewerAsync(container, { fileName, file });
            await settleAsync();

            expect(headers(container), fileName).toEqual(['name', 'age']);
            expect(container.textContent, fileName).toContain('Ada');
        }
    });

    it('shows an error card for a workbook without sheets', async () => {
        vi.mocked(readWorkbook).mockReturnValueOnce({ sheets: [] });

        await renderTableViewerAsync(container, { fileName: 'empty.xlsx', file: new File([''], 'empty.xlsx') });

        expect(container.querySelector('p')?.textContent).toBe('Workbook has no sheets.');
    });

    it('shows an error card when the workbook cannot be read', async () => {
        vi.mocked(readWorkbook).mockImplementationOnce(() => {
            throw new Error('Corrupt zip.');
        });

        await renderTableViewerAsync(container, { fileName: 'broken.xlsx', file: new File([''], 'broken.xlsx') });

        expect(container.querySelectorAll('h2')).toHaveLength(1);
        expect(container.querySelector('h2')?.textContent).toBe('This workbook can\'t be shown');
        expect(container.querySelector('p')?.textContent).toBe('Corrupt zip.');
    });
});

describe('renderTableViewerAsync with a password', () => {
    const PASSWORD = 'tika';
    const ROWS = [['Name', 'Age'], ['Ada', 36]];
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    async function lockedXlsxAsync(password = PASSWORD): Promise<File> {
        return new File([await buildStandardEncryptedAsync({ password, plain: buildTinyXlsx(ROWS) })], 'locked.xlsx');
    }

    function panel(): HTMLElement | null {
        return container.querySelector('.table-locked .password-panel');
    }

    async function panelAsync(reason: string): Promise<void> {
        await vi.waitFor(() => expect(panel()?.dataset['reason']).toBe(reason), { timeout: 5000 });
    }

    function submit(password: string): void {
        (container.querySelector('.password-panel-input') as HTMLInputElement).value = password;
        panel()?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    async function tableAsync(): Promise<void> {
        await vi.waitFor(() => expect(headers(container)).toEqual(['Name', 'Age']), { timeout: 5000 });
    }

    function render(file: File): void {
        void renderTableViewerAsync(container, { fileName: file.name, file });
    }

    it('asks for an XLSX password in the table area, says a wrong one is wrong, and opens with the right one', async () => {
        render(await lockedXlsxAsync());
        await panelAsync('needed');

        expect(container.querySelector('.password-panel-title')?.textContent).toBe('This workbook is protected with a password');
        expect(container.querySelector('.password-panel-file')?.textContent).toBe('locked.xlsx');

        submit('wrong');
        await panelAsync('incorrect');

        expect(container.querySelector('.password-panel-message')?.textContent).toBe('That password is incorrect. Try again.');

        submit(PASSWORD);
        await tableAsync();

        expect(container.textContent).toContain('Ada');
        expect(panel()).toBeNull();
    });

    it('asks for the password of an encrypted macro-enabled workbook in the same way', async () => {
        const plain = buildTinyWorkbook(ROWS, 'xlsm');
        render(new File([await buildStandardEncryptedAsync({ password: PASSWORD, plain })], 'locked.xlsm'));
        await panelAsync('needed');

        expect(container.querySelector('.password-panel-file')?.textContent).toBe('locked.xlsm');

        submit(PASSWORD);
        await tableAsync();

        expect(container.textContent).toContain('Ada');
    });

    it('opens Excel 97–2003 workbooks encrypted with RC4, RC4 CryptoAPI and XOR', async () => {
        for (const scheme of ['rc4', 'cryptoapi', 'xor'] as const) {
            render(new File([buildEncryptedWorkbook(ROWS, PASSWORD, scheme)], `${scheme}.xls`));
            await panelAsync('needed');
            submit(PASSWORD);
            await tableAsync();
        }
    });

    it('shows the closed state after Cancel, also when the pane renders again, and asks again from there', async () => {
        const file = await lockedXlsxAsync();
        render(file);
        await panelAsync('needed');
        (container.querySelector('[data-action="password-cancel"]') as HTMLButtonElement).click();
        await panelAsync('cancelled');

        render(file);
        await panelAsync('cancelled');

        expect(panel()?.textContent).toContain('It stays closed until its password is entered.');

        (container.querySelector('[data-action="password-retry"]') as HTMLButtonElement).click();
        await panelAsync('needed');
    });

    it('doesn\'t ask again for the same snapshot, and asks again once the file changed on disk', async () => {
        const file = await lockedXlsxAsync();
        render(file);
        await panelAsync('needed');
        submit(PASSWORD);
        await tableAsync();

        await renderTableViewerAsync(container, { fileName: file.name, file });
        await tableAsync();

        render(new File([await file.arrayBuffer()], file.name));
        await panelAsync('needed');
    });

    it('opens a workbook locked with Excel\'s own password without asking, as Excel does', async () => {
        await renderTableViewerAsync(container, { fileName: 'readonly.xlsx', file: await lockedXlsxAsync(EXCEL_DEFAULT_PASSWORD) });
        await tableAsync();

        expect(panel()).toBeNull();
    });

    it('keeps the password nowhere: the box is emptied and the page never holds it', async () => {
        const secret = 'Unforgettable-7';
        render(await lockedXlsxAsync(secret));
        await panelAsync('needed');
        const input = container.querySelector('.password-panel-input') as HTMLInputElement;
        submit(secret);

        expect(input.value).toBe('');

        await tableAsync();

        expect(document.body.innerHTML).not.toContain(secret);
    });

    it('says why encryption it can\'t open isn\'t supported', async () => {
        const file = new File([encryptedPackageFile(encryptionInfoStream(4, 3, 0, new Uint8Array(16)), Uint8Array.of(1))], 'vault.xlsx');
        await renderTableViewerAsync(container, { fileName: file.name, file });

        expect(container.querySelector('h2')?.textContent).toBe('This workbook\'s encryption isn\'t supported');
        expect(container.querySelector('p')?.textContent).toContain('Open it in Excel to read it.');
    });
});
