const STUDIO_PATH = 'nib-studio/index.html';

async function openStudioAsync(): Promise<void> {
    const url = chrome.runtime.getURL(STUDIO_PATH);
    await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
    openStudioAsync().catch((error) => {
        console.error('Open Nib Studio failed.', error);
    });
});
