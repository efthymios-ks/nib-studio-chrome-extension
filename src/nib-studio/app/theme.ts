import type { Theme } from './store.js';

export function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
}

export function nextTheme(current: Theme): Theme {
    return current === 'light' ? 'dark' : 'light';
}
