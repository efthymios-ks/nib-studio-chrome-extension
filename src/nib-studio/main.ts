import { App } from './app/app.js';

const root = document.querySelector<HTMLElement>('[data-role="studio-root"]');

if (root != null) {
    const app = new App(root);
    void app.bootstrapAsync();
}
