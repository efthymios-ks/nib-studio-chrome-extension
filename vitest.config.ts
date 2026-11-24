import { defineConfig } from 'vitest/config';

// The test DOM fetches nothing: an iframe opens an empty page and a refused style sheet counts as loaded,
// so neither logs an error.
const environmentOptions = {
    happyDOM: {
        settings: {
            disableIframePageLoading: false,
            enableIframePageLoading: true,
            handleDisabledFileLoadingAsSuccess: true,
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
