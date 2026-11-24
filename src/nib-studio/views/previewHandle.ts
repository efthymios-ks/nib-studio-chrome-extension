// A mounted preview, kept while its tab stays active so unrelated re-renders never reload it.
export interface PreviewHandle {
    readonly element: HTMLElement;
    // Shows a new snapshot of the file, such as after it changed on disk; the same snapshot is ignored.
    update(file: File | null): void;
    // Stops the preview, lets go of its blob URLs, timers and listeners, and takes it out of the page.
    destroy(): void;
}
