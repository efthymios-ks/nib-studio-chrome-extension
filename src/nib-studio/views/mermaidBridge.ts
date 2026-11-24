import mermaid from 'mermaid';
import { h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { errorMessage } from '../../common/errorMessage.js';
import { openBlobInNewTab } from './markdownDiffControls.js';

let initialized = false;

function initialize(): void {
    if (initialized) {
        return;
    }

    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
    });
    initialized = true;
}

export async function renderMermaidSvgAsync(source: string, id: string): Promise<string> {
    initialize();
    const { svg } = await mermaid.render(id, source);

    return svg;
}

export async function renderMermaidIntoAsync(
    placeholder: HTMLElement,
    source: string,
    id: string,
): Promise<void> {
    try {
        const svg = await renderMermaidSvgAsync(source, `nib-${id}-${Math.random().toString(36).slice(2, 8)}`);
        placeholder.innerHTML = svg;
        placeholder.append(buildMermaidTools(source, svg));
    }
    catch (error) {
        const message = errorMessage(error, 'Mermaid render failed.');
        placeholder.classList.remove('md-mermaid');
        placeholder.classList.add('md-mermaid-error');
        placeholder.textContent = message;
    }
}

// Copy-source and enlarge buttons shown under a rendered diagram.
export function buildMermaidTools(source: string, svg: string): HTMLElement {
    const copyButton = h('button', {
        class: 'button md-mermaid-copy',
        text: 'Copy Mermaid',
        attrs: { type: 'button' },
        on: {
            click: () => {
                void copyMermaidSourceAsync(source);
            },
        },
    });
    const enlargeButton = h('button', {
        class: 'button md-mermaid-enlarge',
        text: 'Enlarge',
        attrs: { type: 'button' },
        on: {
            click: () => openBlobInNewTab(new Blob([svg], { type: 'image/svg+xml' })),
        },
    });

    return h('div', { class: 'md-mermaid-tools', children: [copyButton, enlargeButton] });
}

async function copyMermaidSourceAsync(source: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(source);
        toast('Mermaid source copied.', 'ok');
    }
    catch (error) {
        toast(errorMessage(error, 'Copy failed.'), 'fail');
    }
}
