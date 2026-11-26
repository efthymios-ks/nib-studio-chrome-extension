import { defineConfig } from 'vitest/config';

// The test DOM fetches nothing: an iframe opens an empty page, one with an address such as the HTML preview's
// sandbox page included, and a refused style sheet counts as loaded, so none of them logs an error.
const environmentOptions = {
    happyDOM: {
        settings: {
            enableIframePageLoading: true,
            handleDisabledFileLoadingAsSuccess: true,
            navigation: {
                disableChildFrameNavigation: true,
            },
        },
    },
};

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'logic',
                    include: [
                        'src/background/**/*.test.ts',
                        'src/common/**/*.test.ts',
                        'scripts/**/*.test.mjs',
                    ],
                    environment: 'node',
                    environmentOptions,
                },
            },
            {
                test: {
                    name: 'studio',
                    include: ['src/nib-studio/**/*.test.ts'],
                    environment: 'happy-dom',
                    environmentOptions,
                    // Many studio tests drive the whole app, which can pass the 5 s default when every core is busy.
                    testTimeout: 15_000,
                },
            },
        ],
    },
});
