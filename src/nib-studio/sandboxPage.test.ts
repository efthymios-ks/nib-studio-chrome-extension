import { Window as HappyWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SANDBOX_CHANNEL, type SandboxMessage } from '../common/html/sandboxMessages.js';
import { startSandboxPage, type MessageTarget } from './sandboxPage.js';

const STUDIO_ORIGIN = 'chrome-extension://nib';
const PAGE = [
    '<h1 id="top">Top</h1>',
    '<a id="workspace" href="../data/users.csv"><span id="inner">users</span></a>',
    '<a id="web" href="https://example.com/">web</a>',
    '<a id="in-page" href="#far">far</a>',
    '<a id="script" href="javascript:window.ran%20=%20\'caf%C3%A9\'">script</a>',
    '<a id="spaced" href=" java&#9;script:void(0)">spaced</a>',
    '<a id="handled" href="other.html">handled</a>',
    '<map><area id="area" href="map.md"></map>',
    '<h2 id="far">Far</h2>',
].join('');

let happy: HappyWindow;
let page: Window;
let studio: MessageTarget & { postMessage: Mock };
let writePage: Mock<(document: Document, html: string, prepare: () => void) => void>;

beforeEach(() => {
    happy = new HappyWindow({ url: `${STUDIO_ORIGIN}/nib-studio/sandbox.html` });
    page = happy as unknown as Window;
    studio = { postMessage: vi.fn() };
    // Writes the page into the body, as document.write would, after the listeners go on again.
    writePage = vi.fn((document: Document, html: string, prepare: () => void) => {
        prepare();
        document.body.innerHTML = html;
    });
});

afterEach(async () => {
    vi.useRealTimers();
    await happy.happyDOM.close();
});

// Starts the sandbox page as its script does, then lets its own document finish loading.
function start(): void {
    startSandboxPage({ window: page, studio, studioOrigin: STUDIO_ORIGIN, writePage });

    if (page.document.readyState !== 'complete') {
        page.dispatchEvent(new happy.Event('load') as unknown as Event);
    }
}

function posted(): SandboxMessage[] {
    return studio.postMessage.mock.calls.map(([message]) => message as SandboxMessage);
}

function fromStudio(data: unknown, source: unknown = studio, origin = STUDIO_ORIGIN): void {
    page.dispatchEvent(new happy.MessageEvent('message', { data, source: source as never, origin }) as unknown as Event);
}

function render(fragment: string | null = null): void {
    fromStudio({ channel: SANDBOX_CHANNEL, type: 'render', html: PAGE, scroll: { left: 0, top: 300 }, fragment, isSmooth: true });
}

function element(id: string): HTMLElement {
    const found = page.document.getElementById(id);

    if (found == null) {
        throw new Error(`No #${id}`);
    }

    return found;
}

function dispatch(target: EventTarget, event: Event): Event {
    target.dispatchEvent(event);

    return event;
}

function click(id: string, init: { readonly ctrlKey?: boolean } = {}): Event {
    return dispatch(element(id), new happy.MouseEvent('click', { bubbles: true, cancelable: true, ...init }) as unknown as Event);
}

function auxClick(id: string, button: number): Event {
    return dispatch(element(id), new happy.MouseEvent('auxclick', { bubbles: true, cancelable: true, button }) as unknown as Event);
}

function links(): string[] {
    return posted().flatMap((message) => message.type === 'link' ? [message.href] : []);
}

describe('startSandboxPage', () => {
    it('tells the studio it is ready, at the studio\'s origin only', () => {
        start();

        expect(studio.postMessage).toHaveBeenCalledWith({ channel: SANDBOX_CHANNEL, type: 'ready' }, STUDIO_ORIGIN);
    });

    it('takes WebRTC away from the page\'s window before the page arrives, since no content security policy governs it', () => {
        Object.assign(page, { RTCPeerConnection: class {}, webkitRTCPeerConnection: class {}, RTCDataChannel: class {}, RTCIceTransport: class {} });

        start();

        expect(['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceTransport'].filter((name) => name in page)).toEqual([]);
        expect(writePage).not.toHaveBeenCalled();
    });

    it('writes the page the studio sends, once, and takes nothing from other windows, origins or shapes', () => {
        start();

        fromStudio({ channel: SANDBOX_CHANNEL, type: 'render', html: '<p>stranger</p>', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true }, { postMessage: vi.fn() });
        fromStudio({ channel: SANDBOX_CHANNEL, type: 'render', html: '<p>origin</p>', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true }, studio, 'null');
        fromStudio({ channel: SANDBOX_CHANNEL, type: 'render', html: '<p>shape</p>' });
        fromStudio('render');

        expect(writePage).not.toHaveBeenCalled();

        render();
        fromStudio({ channel: SANDBOX_CHANNEL, type: 'render', html: '<p>second</p>', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true });

        expect(writePage).toHaveBeenCalledTimes(1);
        expect(writePage.mock.calls[0]?.[1]).toBe(PAGE);
        expect(page.document.getElementById('top')?.textContent).toBe('Top');
    });

    it('restores the scroll, reveals the place asked for and says it has rendered once the page has loaded', () => {
        const scrollTo = vi.spyOn(page, 'scrollTo').mockImplementation(() => {});
        start();
        render('far');
        const scrollIntoView = vi.fn();
        element('far').scrollIntoView = scrollIntoView;

        expect(posted().map((message) => message.type)).toEqual(['ready']);

        page.dispatchEvent(new happy.Event('load') as unknown as Event);
        page.dispatchEvent(new happy.Event('load') as unknown as Event);

        expect(scrollTo).toHaveBeenCalledWith(0, 300);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(posted().map((message) => message.type)).toEqual(['ready', 'rendered']);
    });

    it('reveals a place the studio asks for, once the page has loaded', () => {
        start();
        render();
        const scrollIntoView = vi.fn();
        element('far').scrollIntoView = scrollIntoView;

        fromStudio({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'far', isSmooth: false });

        expect(scrollIntoView).not.toHaveBeenCalled();

        page.dispatchEvent(new happy.Event('load') as unknown as Event);
        fromStudio({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'top', isSmooth: true });
        fromStudio({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'missing', isSmooth: true });

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('hands the studio the links it follows, and leaves in-page links to the page', () => {
        start();
        render();

        expect(click('workspace').defaultPrevented).toBe(true);
        expect(click('inner').defaultPrevented).toBe(true);
        expect(click('web', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(click('area').defaultPrevented).toBe(true);
        expect(click('in-page').defaultPrevented).toBe(false);
        expect(click('top').defaultPrevented).toBe(false);
        expect(links()).toEqual(['../data/users.csv', '../data/users.csv', 'https://example.com/', 'map.md']);
    });

    it('runs a javascript: link\'s script in the page\'s window, a moment later, since Chrome runs none in the frame', async () => {
        const evaluate = vi.fn();
        Object.defineProperty(page, 'eval', { configurable: true, value: evaluate });
        start();
        render();

        expect(click('script').defaultPrevented).toBe(true);
        expect(click('spaced').defaultPrevented).toBe(true);
        expect(evaluate).not.toHaveBeenCalled();

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(evaluate.mock.calls).toEqual([['window.ran = \'café\''], ['void(0)']]);
        expect(links()).toEqual([]);
    });

    it('leaves a link alone when the page\'s own handler has taken the click', () => {
        start();
        render();
        element('handled').addEventListener('click', (event) => event.preventDefault());

        click('handled');

        expect(links()).toEqual([]);
    });

    it('hands the studio a middle-clicked link, and never lets a link open a window of its own', () => {
        start();
        render();

        expect(auxClick('web', 1).defaultPrevented).toBe(true);
        expect(auxClick('in-page', 1).defaultPrevented).toBe(true);
        expect(auxClick('workspace', 2).defaultPrevented).toBe(true);
        expect(auxClick('top', 1).defaultPrevented).toBe(false);
        expect(links()).toEqual(['https://example.com/']);
    });

    it('saves on Ctrl+S unless the page takes the key itself', () => {
        start();
        render();
        const press = (): Event => dispatch(page.document.body, new happy.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }) as unknown as Event);

        expect(press().defaultPrevented).toBe(true);

        page.document.body.addEventListener('keydown', (event) => event.preventDefault());
        press();

        expect(posted().filter((message) => message.type === 'save')).toHaveLength(1);
    });

    it('keeps a form\'s submission in the page once its handlers have run, and lets a dialog\'s form close its dialog', () => {
        start();
        render();
        page.document.body.insertAdjacentHTML('beforeend', [
            '<form id="search" action="https://example.com/"><button id="send">Send</button><button id="close" formmethod="dialog">Close</button></form>',
            '<dialog open><form id="dialog-form" method="dialog"><button id="ok">OK</button></form></dialog>',
        ].join(''));
        const handled: string[] = [];
        element('search').addEventListener('submit', () => handled.push('search'));
        const submit = (formId: string, submitterId: string): Event => dispatch(element(formId), new happy.SubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
            submitter: element(submitterId) as never,
        }) as unknown as Event);

        expect(submit('search', 'send').defaultPrevented).toBe(true);
        expect(submit('search', 'close').defaultPrevented).toBe(false);
        expect(submit('dialog-form', 'ok').defaultPrevented).toBe(false);
        expect(handled).toEqual(['search', 'search']);
    });

    it('keeps a dropped file from replacing the page', () => {
        start();
        render();

        expect(dispatch(page.document.body, new happy.Event('dragover', { bubbles: true, cancelable: true }) as unknown as Event).defaultPrevented).toBe(true);
        expect(dispatch(page.document.body, new happy.Event('drop', { bubbles: true, cancelable: true }) as unknown as Event).defaultPrevented).toBe(true);
    });

    it('tells the studio the scroll once scrolling pauses', async () => {
        start();
        render();
        page.dispatchEvent(new happy.Event('load') as unknown as Event);
        Object.defineProperty(page, 'scrollY', { configurable: true, get: () => 640 });
        const scroll = (): boolean => page.dispatchEvent(new happy.Event('scroll') as unknown as Event);

        scroll();
        scroll();
        scroll();

        expect(posted().filter((message) => message.type === 'scroll')).toEqual([]);

        await new Promise((resolve) => setTimeout(resolve, 250));

        expect(posted().filter((message) => message.type === 'scroll')).toEqual([{ channel: SANDBOX_CHANNEL, type: 'scroll', left: 0, top: 640 }]);
    });
});

describe('startSandboxPage with document.write', () => {
    it('opens the document, puts its listeners back, then writes and closes it', () => {
        const calls: string[] = [];
        const target = new EventTarget();
        const addEventListener = target.addEventListener.bind(target);
        const fakeDocument = {
            readyState: 'complete',
            open: () => calls.push('open'),
            write: (html: string) => calls.push(`write ${html}`),
            close: () => calls.push('close'),
        };
        const fakeWindow = Object.assign(target, {
            document: fakeDocument,
            addEventListener: (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
                if (type === 'message') {
                    calls.push('listen');
                }

                addEventListener(type, listener, options);
            },
        }) as unknown as Window;
        startSandboxPage({ window: fakeWindow, studio, studioOrigin: STUDIO_ORIGIN });

        target.dispatchEvent(new MessageEvent('message', {
            data: { channel: SANDBOX_CHANNEL, type: 'render', html: '<p>Hi</p>', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true },
            origin: STUDIO_ORIGIN,
            source: studio as unknown as Window,
        }));

        expect(calls).toEqual(['listen', 'open', 'listen', 'write <p>Hi</p>', 'close']);
    });

    it('writes the page as markup of its own Trusted Types policy, so the default policy never judges it', () => {
        const written: unknown[] = [];
        const names: string[] = [];
        const trustedTypes = {
            createPolicy: (name: string, rules: { readonly createHTML?: (html: string) => string | null }) => {
                names.push(name);

                return { createHTML: (html: string) => ({ policy: name, html: rules.createHTML?.(html) }) };
            },
        };
        const target = new EventTarget();
        const fakeWindow = Object.assign(target, {
            trustedTypes,
            document: { readyState: 'complete', open: () => {}, write: (markup: unknown) => written.push(markup), close: () => {} },
        }) as unknown as Window;
        startSandboxPage({ window: fakeWindow, studio, studioOrigin: STUDIO_ORIGIN });

        target.dispatchEvent(new MessageEvent('message', {
            data: { channel: SANDBOX_CHANNEL, type: 'render', html: '<p>The builder leaves out a frame with a srcdoc.</p>', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true },
            origin: STUDIO_ORIGIN,
            source: studio as unknown as Window,
        }));

        expect(names).toEqual(['default', 'nib-studio-page']);
        expect(written).toEqual([{ policy: 'nib-studio-page', html: '<p>The builder leaves out a frame with a srcdoc.</p>' }]);
    });
});
