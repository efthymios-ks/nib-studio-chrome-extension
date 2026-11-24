import { afterEach, describe, expect, it } from 'vitest';
import { VENDOR_LICENSES } from '../vendorLicenses.js';
import { aboutIntro, showAboutDialog } from './aboutDialog.js';

function aboutBackdrops(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.modal-backdrop[data-role="about"]')];
}

function listedPackages(): string[] {
    return [...document.querySelectorAll('.about-license-item')].map((item) => [
        item.querySelector('.about-license-name')?.textContent,
        item.querySelector('.about-license-version')?.textContent,
    ].join(' '));
}

afterEach(() => {
    for (const node of document.querySelectorAll('.modal-backdrop')) {
        node.remove();
    }
});

describe('showAboutDialog', () => {
    it('renders an accessible modal listing every third-party license', () => {
        showAboutDialog();
        const modal = document.querySelector<HTMLElement>('.about-modal');
        const items = document.querySelectorAll('.about-license-item');
        const first = VENDOR_LICENSES[0]!;

        expect(modal?.getAttribute('role')).toBe('dialog');
        expect(modal?.getAttribute('aria-modal')).toBe('true');
        expect(modal?.getAttribute('aria-labelledby')).toBe('about-title');
        expect(document.getElementById('about-title')?.textContent).toBe('About & third-party licences');
        expect(items).toHaveLength(VENDOR_LICENSES.length);
        expect(items[0]?.querySelector('.about-license-name')?.textContent).toBe(first.name);
        expect(items[0]?.querySelector('.about-license-version')?.textContent).toBe(first.version);
        expect(items[0]?.querySelector('.about-license-badge')?.textContent).toBe(first.license);
        expect(items[0]?.querySelector('.about-license-text')?.textContent).toBe(first.text);
    });

    it('says how many packages ship and lists each one, sorted by name and then version', () => {
        showAboutDialog();
        const names = listedPackages().map((listed) => listed.split(' ')[0] ?? '');

        expect(document.querySelector('.about-intro')?.textContent).toBe(aboutIntro(VENDOR_LICENSES.length));
        expect(listedPackages()).toEqual(VENDOR_LICENSES.map((entry) => `${entry.name} ${entry.version}`));
        expect(names).toEqual([...names].sort());
        expect(listedPackages().filter((listed) => listed.startsWith('dompurify '))).toHaveLength(2);
    });

    it('replaces an already open about dialog instead of stacking', () => {
        showAboutDialog();
        showAboutDialog();

        expect(aboutBackdrops()).toHaveLength(1);
    });

    it('closes on the Close button', () => {
        showAboutDialog();
        const close = [...document.querySelectorAll<HTMLButtonElement>('.modal-footer button')].find((button) => button.textContent === 'Close');
        close?.click();

        expect(aboutBackdrops()).toHaveLength(0);
    });

    it('closes on Escape and stops listening afterwards', () => {
        showAboutDialog();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(escape);

        expect(aboutBackdrops()).toHaveLength(0);
        expect(escape.defaultPrevented).toBe(true);

        const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(later);

        expect(later.defaultPrevented).toBe(false);
    });

    it('closes on a backdrop click but not on a click inside the modal', () => {
        showAboutDialog();
        document.querySelector<HTMLElement>('.about-intro')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(aboutBackdrops()).toHaveLength(1);

        aboutBackdrops()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(aboutBackdrops()).toHaveLength(0);
    });
});

describe('aboutIntro', () => {
    it('counts the packages, with a thousands separator and one package in the singular', () => {
        expect(aboutIntro(118)).toBe('Nib Studio ships with the following 118 third-party packages. Each one keeps its original licence.');
        expect(aboutIntro(1_204)).toContain('following 1,204 third-party packages.');
        expect(aboutIntro(1)).toContain('following 1 third-party package.');
    });
});
