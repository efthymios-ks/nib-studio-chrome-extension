import { describe, expect, it } from 'vitest';
import { guardPageWindow } from './sandboxGuard.js';

interface FakeRules {
    readonly createHTML?: (input: string, type: string, sink: string) => string | null;
    readonly createScript?: (input: string) => string;
    readonly createScriptURL?: (input: string) => string;
}

// Plays Chrome's Trusted Types: each policy has a name of its own, and its HTML comes back wrapped.
function fakeTrustedTypes(): { readonly policies: Map<string, FakeRules>; createPolicy(name: string, rules: FakeRules): unknown } {
    const policies = new Map<string, FakeRules>();

    return {
        policies,
        createPolicy: (name, rules) => {
            if (policies.has(name)) {
                throw new TypeError(`Policy ${name} exists`);
            }

            policies.set(name, rules);

            return { createHTML: (input: string) => ({ trusted: rules.createHTML?.(input, 'TrustedHTML', 'Document write') }) };
        },
    };
}

function windowWith(properties: Record<string, unknown>): Window {
    return { ...properties } as unknown as Window;
}

// The default policy's answer for markup bound for a sink: the markup, or null where it refuses.
function defaultPolicyFor(): (html: string, sink: string) => string | null {
    const trustedTypes = fakeTrustedTypes();
    guardPageWindow(windowWith({ trustedTypes }));
    const rules = trustedTypes.policies.get('default');

    return (html, sink) => rules?.createHTML?.(html, 'TrustedHTML', sink) ?? null;
}

describe('guardPageWindow', () => {
    it('takes every WebRTC interface and XSLT from the page\'s window, and nothing else', () => {
        const page = windowWith({
            RTCPeerConnection: class {},
            webkitRTCPeerConnection: class {},
            RTCDataChannel: class {},
            RTCIceTransport: class {},
            RTCSessionDescription: class {},
            XSLTProcessor: class {},
            fetch: () => {},
            MediaStream: class {},
            RTCish: 1,
        });

        guardPageWindow(page);

        expect(Object.keys(page).sort()).toEqual(['MediaStream', 'RTCish', 'fetch']);
    });

    it('gives the page\'s text back as it is where the browser has no Trusted Types', () => {
        const toMarkup = guardPageWindow(windowWith({}));

        expect(toMarkup('<p>Hi</p>')).toBe('<p>Hi</p>');
    });

    it('makes the default policy and its own before the page can, and writes the page through its own', () => {
        const trustedTypes = fakeTrustedTypes();

        const toMarkup = guardPageWindow(windowWith({ trustedTypes }));

        expect([...trustedTypes.policies.keys()]).toEqual(['default', 'nib-studio-page']);
        expect(toMarkup('<p>Frames with a srcdoc are left out.</p>')).toEqual({ trusted: '<p>Frames with a srcdoc are left out.</p>' });
        expect(() => trustedTypes.createPolicy('default', {})).toThrow(TypeError);
    });

    it('has the default policy pass every script and script address as written', () => {
        const trustedTypes = fakeTrustedTypes();
        guardPageWindow(windowWith({ trustedTypes }));
        const rules = trustedTypes.policies.get('default');

        expect(rules?.createScript?.('window.ran = true')).toBe('window.ran = true');
        expect(rules?.createScriptURL?.('blob:null/1')).toBe('blob:null/1');
    });
});

describe('the default policy', () => {
    it('refuses a srcdoc set as a property or an attribute, by any of the ways to set one', () => {
        const judge = defaultPolicyFor();

        for (const sink of ['HTMLIFrameElement srcdoc', 'Element setAttribute', 'Element setAttributeNS', 'Element setAttributeNode']) {
            expect(judge('<script>run()</script>', sink), sink).toBeNull();
        }
    });

    it('refuses a srcdoc in markup, in any case, in a shadow root or under an XML prefix', () => {
        const judge = defaultPolicyFor();

        expect(judge('<IFRAME SRCDOC="<p>x</p>"></IFRAME>', 'Element innerHTML')).toBeNull();
        expect(judge('<div><template shadowrootmode="closed"><iframe srcdoc="x"></iframe></template></div>', 'Element setHTMLUnsafe')).toBeNull();
        expect(judge('<x:iframe xmlns:x="http://www.w3.org/1999/xhtml" srcdoc="x"/>', 'DOMParser parseFromString')).toBeNull();
    });

    it('refuses an XML entity, which can spell a srcdoc out of character references', () => {
        const judge = defaultPolicyFor();

        expect(judge('<!DOCTYPE r [<!ENTITY e "&#60;iframe &#115;rcdoc=\'x\'/&#62;">]><r>&e;</r>', 'DOMParser parseFromString')).toBeNull();
    });

    it('passes markup that gives no frame a document, frames with an address included', () => {
        const judge = defaultPolicyFor();

        expect(judge('<p>Plain <b>text</b></p>', 'Element innerHTML')).toBe('<p>Plain <b>text</b></p>');
        expect(judge('<iframe src="https://example.com/"></iframe>', 'Element insertAdjacentHTML')).toBe('<iframe src="https://example.com/"></iframe>');
        expect(judge('<!doctype html><title>Page</title>', 'Document write')).toBe('<!doctype html><title>Page</title>');
    });
});
