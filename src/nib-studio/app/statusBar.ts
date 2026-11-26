import { basename, extension } from '../../common/fs/fileEntry.js';
import { fileTypeLabel, resolveFileType } from '../../common/fs/fileTypes.js';
import { archiveTypeLabel } from '../../common/preview/archiveFormat.js';
import { mediaTypeLabel } from '../../common/preview/mediaFormat.js';
import type { AppState, OpenFile } from './store.js';
import { ABOUT_TITLE, showAboutDialog } from './aboutDialog.js';
import { diffTabTitle } from './diffTabs.js';
import { clear, h } from './dom.js';
import { sheetLabelOf } from '../views/tableViewer.js';
import { holdsNoText } from '../views/viewerKinds.js';
import { textEncodingLabel } from '../../common/text/textEncoding.js';

export function renderStatusBar(container: HTMLElement, state: AppState): void {
    clear(container);

    const aboutButton = h('button', {
        class: 'icon-button status-about',
        text: '⚙',
        attrs: { type: 'button', title: ABOUT_TITLE, 'aria-label': ABOUT_TITLE },
        on: { click: () => showAboutDialog() },
    });

    if (state.workspace == null) {
        container.append(
            h('span', { class: 'status-item status-item-file', text: 'Pick a workspace folder to begin.' }),
            h('span', { class: 'status-spacer' }),
            aboutButton,
        );

        return;
    }

    const active = state.openFiles.find((file) => file.path === state.activePath);
    const activeDiff = state.diffTabs.find((tab) => tab.id === state.activePath);
    const dirtyCount = state.openFiles.filter((file) => file.dirty).length;
    const fileText = activeDiff != null ? diffTabTitle(activeDiff) : active == null ? '—' : basename(active.path);
    const languageText = activeDiff != null ? 'Compare' : active == null ? '' : languageLabel(active.path, active.binary === true);
    // The sheet a workbook of several sheets shows, such as `Sheet 2 of 3 · Q2`.
    const sheetText = activeDiff == null && active != null ? sheetLabelOf(active.path) : null;

    container.append(
        h('span', { class: 'status-item status-item-file', text: fileText }),
        h('span', { class: 'status-item status-item-secondary', text: languageText }),
        ...(sheetText == null ? [] : [h('span', { class: 'status-item status-item-secondary', text: sheetText })]),
        ...(active != null && isReadAsText(active)
            ? [h('span', { class: 'status-item status-item-secondary', text: textEncodingLabel(active.encoding ?? 'utf-8') })]
            : []),
        dirtyCount > 0
            ? h('span', { class: 'status-item', dataset: { tone: 'warn' }, text: `${dirtyCount} unsaved` })
            : h('span', { class: 'status-item', dataset: { tone: 'ok' }, text: 'clean' }),
        h('span', { class: 'status-spacer' }),
        h('span', { class: 'status-item status-item-secondary', dataset: { tone: 'ok' }, text: `Workspace: ${state.workspace.name}` }),
        aboutButton,
    );
}

// Only a file read as text has a text encoding. Previews, such as Word documents, PDFs, images and archives,
// workbooks, which are read as sheets, and files that aren't text have none; CSV and TSV are text.
function isReadAsText(file: OpenFile): boolean {
    const name = basename(file.path);

    return !holdsNoText(name) && file.binary !== true && resolveFileType(name).id !== 'excel';
}

function languageLabel(path: string, isBinary: boolean): string {
    if (isBinary) {
        return 'Binary';
    }

    const typeLabel = fileTypeLabel(path);

    if (typeLabel != null) {
        return typeLabel;
    }

    const typeId = resolveFileType(basename(path)).id;

    if (typeId === 'archive') {
        return archiveTypeLabel(basename(path));
    }

    if (typeId === 'audio' || typeId === 'video') {
        return mediaTypeLabel(basename(path), typeId === 'audio' ? 'Audio' : 'Video');
    }

    const ext = extension(path);

    if (ext === 'json') {
        return 'JSON';
    }

    if (ext === 'md' || ext === 'markdown') {
        return 'Markdown';
    }

    if (ext === 'ts' || ext === 'tsx') {
        return 'TypeScript';
    }

    if (ext === 'js' || ext === 'mjs') {
        return 'JavaScript';
    }

    if (ext === 'html') {
        return 'HTML';
    }

    if (ext === 'css' || ext === 'scss') {
        return 'CSS';
    }

    if (ext === 'yml' || ext === 'yaml') {
        return 'YAML';
    }

    return ext === '' ? 'Text' : ext.toUpperCase();
}
