import { decodeBase64 } from '../../common/encoding/base64.js';
import { copyFailureMessage, copyTextAsync } from '../app/clipboard.js';
import { toast } from '../app/toast.js';

// One delegated listener copies code blocks; each `.md-code-copy` button carries its source in base64,
// so the handler keeps no state across re-renders.
export function attachCodeCopyHandler(container: HTMLElement): void {
    if (container.dataset['codeCopyBound'] === 'true') {
        return;
    }

    container.dataset['codeCopyBound'] = 'true';
    container.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest<HTMLButtonElement>('.md-code-copy');

        if (button == null) {
            return;
        }

        event.preventDefault();
        void copyCodeFromButtonAsync(button);
    });
}

async function copyCodeFromButtonAsync(button: HTMLButtonElement): Promise<void> {
    const encoded = button.getAttribute('data-code') ?? '';

    if (encoded === '') {
        return;
    }

    try {
        await copyTextAsync(decodeBase64(encoded));
        toast('Code copied.', 'ok');
    }
    catch (error) {
        toast(copyFailureMessage(error), 'fail');
    }
}
