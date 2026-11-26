import { startSandboxPage } from './sandboxPage.js';

// Opened on its own rather than in an HTML preview, the sandbox page has no studio to draw for.
if (window.parent !== window) {
    startSandboxPage({
        window,
        studio: window.parent,
        studioOrigin: new URL(window.location.href).origin,
    });
}
