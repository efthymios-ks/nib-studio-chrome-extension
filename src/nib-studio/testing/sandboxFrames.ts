import { SANDBOX_CHANNEL, type StudioMessage } from '../../common/html/sandboxMessages.js';

// Plays the sandbox page of an HTML preview's frame in the tests, where happy-dom loads no extension page.
export interface FakeSandboxPage {
    readonly frame: HTMLIFrameElement;
    // The window the frame's messages come from.
    readonly window: Window;
    // Every message the studio posted to the frame.
    readonly received: ReadonlyArray<StudioMessage>;
    // Posts a message from the sandbox page to the studio, from its opaque origin unless another is given.
    post(data: unknown, origin?: string): void;
    // The page the studio sent in its last `render` message, or null.
    page(): string | null;
}

// Stands in for the sandbox page of a preview frame, from now on.
export function fakeSandboxPage(frame: HTMLIFrameElement): FakeSandboxPage {
    const received: StudioMessage[] = [];
    const fakeWindow = { postMessage: (message: StudioMessage) => received.push(message) } as unknown as Window;
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => fakeWindow });

    return {
        frame,
        window: fakeWindow,
        received,
        post: (data, origin = 'null') => {
            window.dispatchEvent(new MessageEvent('message', { data, origin, source: fakeWindow }));
        },
        page: () => {
            const render = received.findLast((message) => message.type === 'render');

            return render?.type === 'render' ? render.html : null;
        },
    };
}

// Draws the newest frame of a preview as its sandbox page would: it asks for the page, then says it has loaded.
// The newest frame comes first, beneath the shown one.
export function drawSandboxPage(container: ParentNode): FakeSandboxPage {
    const frame = container.querySelector<HTMLIFrameElement>('iframe.html-preview-frame');

    if (frame == null) {
        throw new Error('The preview has no frame');
    }

    const sandbox = fakeSandboxPage(frame);
    sandbox.post({ channel: SANDBOX_CHANNEL, type: 'ready' });
    sandbox.post({ channel: SANDBOX_CHANNEL, type: 'rendered' });

    return sandbox;
}
