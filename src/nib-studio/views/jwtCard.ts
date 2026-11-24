import { decodeJwt, jwtValidity, type DecodedJwt, type JwtTimeClaim, type JwtTimeClaimName } from '../../common/encoding/jwt.js';
import { formatLocalDateTime, formatRelativeTime } from '../../common/text/timeFormat.js';
import { clear, h } from '../app/dom.js';
import {
    buildHint,
    buildLabel,
    buildMessage,
    buildToolCard,
    describeError,
    runOnEnter,
    selectAllOnCopyKey,
    selectError,
    showMessage,
    toolId,
    type ToolCard,
    type ToolCardContext,
} from './toolCard.js';

const CLAIM_LABELS: Readonly<Record<JwtTimeClaimName, string>> = Object.freeze({
    exp: 'Expires (exp)',
    nbf: 'Not before (nbf)',
    iat: 'Issued (iat)',
});

// Decodes a pasted token on Enter. The signature is never checked: that needs the key, and this card
// is for reading what a token says.
export function buildJwtCard(context: ToolCardContext): ToolCard {
    const jwt = context.state.jwt;
    const tokenId = toolId('jwt', 'token');
    const hintId = toolId('jwt', 'hint');
    const headerId = toolId('jwt', 'header');
    const payloadId = toolId('jwt', 'payload');

    const tokenArea = h('textarea', {
        class: 'textarea textarea-mono tool-textarea',
        attrs: {
            'id': tokenId,
            'rows': '3',
            'spellcheck': 'false',
            'placeholder': 'Paste a JWT, then press Enter',
            'aria-describedby': hintId,
        },
    });
    tokenArea.value = jwt.draft;

    tokenArea.addEventListener('input', () => {
        jwt.draft = tokenArea.value;
    });

    runOnEnter(tokenArea, () => {
        jwt.draft = tokenArea.value;
        jwt.decoded = decodeJwt(tokenArea.value);
        context.refresh();

        if (jwt.decoded != null && !jwt.decoded.ok) {
            selectError(tokenArea, jwt.decoded.error);
        }
    });

    const error = buildMessage();
    const validity = h('span', { class: 'badge jwt-validity' });
    const signature = h('span', { class: 'jwt-signature' });
    const claims = h('dl', { class: 'jwt-claims' });
    const headerJson = h('pre', { class: 'jwt-json', attrs: { 'id': headerId, 'tabindex': '0', 'aria-label': 'Header JSON' } });
    const payloadJson = h('pre', { class: 'jwt-json', attrs: { 'id': payloadId, 'tabindex': '0', 'aria-label': 'Payload JSON' } });
    selectAllOnCopyKey(headerJson);
    selectAllOnCopyKey(payloadJson);

    const result = h('div', {
        class: 'jwt-result',
        children: [
            h('div', { class: 'jwt-status', children: [validity, signature] }),
            claims,
            h('div', {
                class: 'jwt-sections',
                children: [
                    h('div', { class: 'tool-field', children: [h('span', { class: 'tool-label', text: 'Header' }), headerJson] }),
                    h('div', { class: 'tool-field', children: [h('span', { class: 'tool-label', text: 'Payload' }), payloadJson] }),
                ],
            }),
        ],
    });

    const update = (): void => {
        const decoded = jwt.decoded;
        showMessage(error, decoded == null || decoded.ok ? null : { text: describeError(decoded.error, jwt.draft), tone: 'fail' });
        result.hidden = decoded == null || !decoded.ok;

        if (decoded == null || !decoded.ok) {
            return;
        }

        const token = decoded.value;
        const now = Date.now();
        const status = describeValidity(token, now);
        validity.textContent = status.text;
        validity.dataset['tone'] = status.tone;
        signature.textContent = describeSignature(token);
        headerJson.textContent = token.headerJson;
        payloadJson.textContent = token.payloadJson;

        clear(claims);

        for (const claim of token.timeClaims) {
            claims.append(
                h('dt', { text: CLAIM_LABELS[claim.name] }),
                h('dd', { text: describeClaim(claim, now) }),
            );
        }

        claims.hidden = token.timeClaims.length === 0;
    };

    const element = buildToolCard({
        id: 'jwt',
        title: 'JWT decode',
        tools: [h('span', { class: 'toolbar-spacer' }), h('span', { class: 'badge', dataset: { tone: 'warn' }, text: 'Signature not verified' })],
        children: [
            h('div', { class: 'tool-field', children: [buildLabel(tokenId, 'Token'), tokenArea] }),
            buildHint(hintId, 'Enter to decode · the signature is not checked'),
            error,
            result,
        ],
    });

    return { element, update };
}

function describeValidity(token: DecodedJwt, now: number): { readonly text: string; readonly tone: string } {
    const seconds = (name: JwtTimeClaimName): number => (token.timeClaims.find((claim) => claim.name === name)?.seconds ?? 0) * 1000;
    const state = jwtValidity(token.timeClaims, now);

    if (state === 'expired') {
        return { text: `Expired ${formatRelativeTime(seconds('exp'), now)}`, tone: 'fail' };
    }

    if (state === 'not-yet-valid') {
        return { text: `Not valid yet · starts ${formatRelativeTime(seconds('nbf'), now)}`, tone: 'warn' };
    }

    if (state === 'active') {
        return { text: `Not expired · expires ${formatRelativeTime(seconds('exp'), now)}`, tone: 'ok' };
    }

    return { text: 'No expiry', tone: 'muted' };
}

function describeSignature(token: DecodedJwt): string {
    if (token.algorithm === 'none' || token.signatureLength === 0) {
        return `Unsigned (alg ${token.algorithm ?? 'missing'})`;
    }

    return `${token.algorithm ?? 'Unknown algorithm'} · ${token.signatureLength}-byte signature, not verified`;
}

function describeClaim(claim: JwtTimeClaim, now: number): string {
    if (claim.seconds == null) {
        return `Not a number: ${JSON.stringify(claim.raw)}`;
    }

    const milliseconds = claim.seconds * 1000;

    return `${formatLocalDateTime(new Date(milliseconds))} · ${formatRelativeTime(milliseconds, now)}`;
}
