// The Trusted Types API, which TypeScript's DOM library doesn't declare.
interface TrustedTypePolicyRules {
    readonly createHTML?: (input: string, type: string, sink: string) => string | null;
    readonly createScript?: (input: string) => string;
    readonly createScriptURL?: (input: string) => string;
}

interface TrustedTypePolicy {
    createHTML(input: string): unknown;
}

interface TrustedTypePolicyFactory {
    createPolicy(name: string, rules: TrustedTypePolicyRules): TrustedTypePolicy;
}

// Turns the page the studio sends into what the document takes: a TrustedHTML object where Trusted Types are on,
// and the text itself where they aren't, as in tests.
export type PageMarkup = (html: string) => unknown;

// The policy that writes the page the studio sends. The sandbox's `trusted-types` directive names only it and
// `default`, and both exist before the page's first script, so the page can make no policy of its own.
const PAGE_POLICY = 'nib-studio-page';
// WebRTC's interfaces, `RTCPeerConnection` and its parts, with the older `webkitRTCPeerConnection`.
const WEBRTC_NAME = /^(?:webkit)?RTC[A-Z]/;
// XSLT builds elements, `srcdoc` included, from no markup the policy sees.
const MARKUP_BUILDERS = new Set(['XSLTProcessor']);
// Markup that gives a frame a document of its own: a `srcdoc`, or an XML entity, which can spell one out
// in character references.
const FRAME_DOCUMENT_MARKUP = /srcdoc|<!ENTITY/i;
// The sinks that set an attribute: the only attribute that takes markup is `srcdoc`.
const SRCDOC_SINK = /srcdoc|setAttribute/i;

// Keeps the page in the sandbox page from the network by the ways no content security policy governs in Chrome.
// WebRTC sends its own packets, to STUN and TURN servers, so it goes from the page's window,
// and a frame of the page's own, which would bring a window with WebRTC again, never runs a script:
// - the sandbox's `frame-src 'none'` refuses every frame with an address, `data:` and `blob:` included;
// - its `require-trusted-types-for 'script'` hands every `srcdoc` and every piece of markup to the `default` policy,
//   which refuses a `srcdoc`;
// - a `javascript:` address in a frame meets Trusted Types in the frame, which has no policy to let it run;
// - a frame with no address has an origin of its own, out of the page's reach.
// Runs before the page's first script; the page's own markup and scripts otherwise go through as written.
export function guardPageWindow(page: Window): PageMarkup {
    for (const name of Object.getOwnPropertyNames(page)) {
        if (WEBRTC_NAME.test(name) || MARKUP_BUILDERS.has(name)) {
            Reflect.deleteProperty(page, name);
        }
    }

    const factory = (page as Partial<{ readonly trustedTypes: TrustedTypePolicyFactory }>).trustedTypes;

    if (factory == null) {
        return (html) => html;
    }

    factory.createPolicy('default', {
        createHTML: (html, _type, sink) => givesFrameDocument(html, sink) ? null : html,
        createScript: (script) => script,
        createScriptURL: (url) => url,
    });
    const policy = factory.createPolicy(PAGE_POLICY, { createHTML: (html) => html });

    return (html) => policy.createHTML(html);
}

// Whether markup bound for a sink would give a frame a document, and with it scripts, of its own.
function givesFrameDocument(html: string, sink: string): boolean {
    return SRCDOC_SINK.test(sink) || FRAME_DOCUMENT_MARKUP.test(html);
}
