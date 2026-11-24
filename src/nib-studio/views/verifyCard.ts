import { algorithmsForLength, findMatches, parseExpectedDigest, type DigestCandidate, type ExpectedDigest } from '../../common/hash/digestMatch.js';
import { formatDigest } from '../../common/hash/digestFormat.js';
import { HASH_ALGORITHMS, type HashAlgorithm } from '../../common/hash/hash.js';
import { HMAC_ALGORITHMS } from '../../common/hash/hmac.js';
import { formatByteSize } from '../../common/text/byteSize.js';
import { h } from '../app/dom.js';
import type { HashSurfaceState } from './hashSurfaceState.js';
import {
    buildHint,
    buildLabel,
    buildMessage,
    buildToolCard,
    describeError,
    runOnEnter,
    selectError,
    showMessage,
    toolId,
    type ToolCard,
    type ToolCardContext,
} from './toolCard.js';

export type VerifyOutcome =
    | { readonly kind: 'idle' }
    | { readonly kind: 'nothing-hashed' }
    | { readonly kind: 'invalid'; readonly message: string; readonly position: number | null; readonly length: number }
    | { readonly kind: 'checked'; readonly expected: ExpectedDigest; readonly matches: ReadonlyArray<string> };

// The submitted digest against every digest the Hash and HMAC cards hold now.
export function evaluateVerify(state: HashSurfaceState): VerifyOutcome {
    const parsed = parseExpectedDigest(state.verify.submitted);

    if (parsed == null) {
        return { kind: 'idle' };
    }

    if (!parsed.ok) {
        return {
            kind: 'invalid',
            message: describeError(parsed.error, state.verify.submitted),
            position: parsed.error.position,
            length: parsed.error.length,
        };
    }

    const candidates = verifyCandidates(state);

    if (candidates.length === 0) {
        return { kind: 'nothing-hashed' };
    }

    return { kind: 'checked', expected: parsed.value, matches: findMatches(parsed.value, candidates) };
}

// The labels of the digests that match, for the cards to mark their rows.
export function verifyMatches(state: HashSurfaceState): ReadonlySet<string> {
    const outcome = evaluateVerify(state);

    return new Set(outcome.kind === 'checked' ? outcome.matches : []);
}

export function buildVerifyCard(context: ToolCardContext): ToolCard {
    const { state } = context;
    const inputId = toolId('verify', 'expected');
    const hintId = toolId('verify', 'hint');
    const input = h('input', {
        class: 'input input-mono',
        attrs: {
            'id': inputId,
            'type': 'text',
            'spellcheck': 'false',
            'autocomplete': 'off',
            'placeholder': 'Paste a published checksum, then press Enter',
            'aria-describedby': hintId,
        },
    });
    input.value = state.verify.draft;

    input.addEventListener('input', () => {
        state.verify.draft = input.value;
    });

    runOnEnter(input, () => {
        state.verify.submitted = input.value;
        context.refresh();
        const outcome = evaluateVerify(state);

        if (outcome.kind === 'invalid') {
            selectError(input, outcome);
        }
    });

    const verdict = h('p', { class: 'verify-verdict', attrs: { 'role': 'status', 'aria-live': 'polite' } });
    const detail = buildMessage();
    const computed = buildMessage();
    computed.classList.add('verify-computed');
    const result = h('div', { class: 'verify-result', children: [verdict, detail, computed] });

    const update = (): void => {
        const outcome = evaluateVerify(state);
        const view = describeOutcome(outcome, state);
        result.hidden = view == null;
        result.dataset['tone'] = view?.tone ?? 'muted';
        verdict.textContent = view?.verdict ?? '';
        showMessage(detail, view?.detail == null ? null : { text: view.detail, tone: 'muted' });
        showMessage(computed, view?.computed == null ? null : { text: view.computed, tone: 'muted' });
    };

    const element = buildToolCard({
        id: 'verify',
        title: 'Verify',
        children: [
            h('div', { class: 'tool-field', children: [buildLabel(inputId, 'Expected digest'), input] }),
            buildHint(hintId, 'Enter to verify · hex or Base64, or a sha256sum line · checked against every digest on this page'),
            result,
        ],
    });

    return { element, update };
}

interface OutcomeView {
    readonly tone: 'ok' | 'fail' | 'muted';
    readonly verdict: string;
    readonly detail: string | null;
    readonly computed: string | null;
}

function describeOutcome(outcome: VerifyOutcome, state: HashSurfaceState): OutcomeView | null {
    if (outcome.kind === 'idle') {
        return null;
    }

    if (outcome.kind === 'invalid') {
        return { tone: 'fail', verdict: outcome.message, detail: null, computed: null };
    }

    if (outcome.kind === 'nothing-hashed') {
        return { tone: 'muted', verdict: 'Nothing to check against yet', detail: 'Hash some text or a file first.', computed: null };
    }

    const { expected, matches } = outcome;
    const suggested = expected.namedAlgorithm == null ? algorithmsForLength(expected.bytes.length) : [expected.namedAlgorithm];
    const encoding = expected.encoding === 'hex' ? 'Hex' : 'Base64';
    const lengthNote = suggested.length > 0
        ? `the length of ${suggested.join(' or ')}`
        : 'no algorithm here gives that length';
    const detail = `${encoding} · ${expected.bytes.length} bytes, ${lengthNote}`;
    const firstMatch = matches[0];

    if (firstMatch != null) {
        return {
            tone: 'ok',
            verdict: `Matches ${matches.join(' and ')}`,
            detail: `${detail} · ${firstMatch.startsWith('HMAC-') ? 'HMAC of the message' : `digest of ${describeSourceName(state)}`}`,
            computed: null,
        };
    }

    return { tone: 'fail', verdict: 'No match', detail, computed: describeComputed(state, suggested, expected) };
}

// What the suggested algorithm actually gives, written like the expected digest so the two compare by eye.
function describeComputed(state: HashSurfaceState, suggested: ReadonlyArray<HashAlgorithm>, expected: ExpectedDigest): string | null {
    const algorithm = suggested[0];

    if (algorithm == null) {
        return null;
    }

    const format = expected.encoding === 'hex' ? 'hex' : 'base64';
    const digest = state.hash.digests?.get(algorithm);

    if (digest != null) {
        return `${algorithm} of ${describeSourceName(state)}: ${formatDigest(digest, format)}`;
    }

    const signature = algorithm === 'MD5' ? null : state.hmac.signatures?.get(algorithm);

    return signature == null ? null : `HMAC-${algorithm} of the message: ${formatDigest(signature, format)}`;
}

function describeSourceName(state: HashSurfaceState): string {
    const source = state.hash.source;

    if (source?.kind === 'file') {
        return `${source.name} (${formatByteSize(source.size)})`;
    }

    return 'the text';
}

function verifyCandidates(state: HashSurfaceState): DigestCandidate[] {
    const candidates: DigestCandidate[] = [];

    for (const algorithm of HASH_ALGORITHMS) {
        const bytes = state.hash.digests?.get(algorithm);

        if (bytes != null) {
            candidates.push({ label: algorithm, bytes });
        }
    }

    for (const algorithm of HMAC_ALGORITHMS) {
        const bytes = state.hmac.signatures?.get(algorithm);

        if (bytes != null) {
            candidates.push({ label: `HMAC-${algorithm}`, bytes });
        }
    }

    return candidates;
}
