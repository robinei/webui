#!/usr/bin/env bun

import { router } from './src/index';
import { watch } from 'fs';

// Map from importPath (e.g. './pages/test') to chunk filename (e.g. 'test-abc123.js')
let chunkManifest: Map<string, string> = new Map();

async function build() {
    const result = await Bun.build({
        entrypoints: ['./src/index.ts'],
        outdir: './build',
        target: 'browser',
        sourcemap: 'inline',
        splitting: true,
        naming: '[dir]/[name]-[hash].[ext]',
        metafile: true,
    });

    if (!result.success) {
        console.error('Build failed:', result.logs);
        return false;
    }

    // Build chunk manifest from metafile
    const newManifest = new Map<string, string>();

    if (!result.metafile) {
        console.warn('No metafile available - chunks cannot be mapped');
        chunkManifest = newManifest;
        return true;
    }
    //console.log(result.metafile);

    // Map each output to its primary input file
    for (const [outputPath, outputInfo] of Object.entries(result.metafile.outputs)) {
        const relativePath = outputPath.replace(process.cwd() + '/build/', '');

        // Get all input files for this chunk
        const inputPaths = Object.keys(outputInfo.inputs);

        // Find the primary input (typically the first one, or the one with most bytes)
        if (inputPaths.length > 0) {
            // Sort by bytesInOutput to find the main module
            const sortedInputs = inputPaths.sort((a, b) => {
                const bytesA = outputInfo.inputs[a]?.bytesInOutput || 0;
                const bytesB = outputInfo.inputs[b]?.bytesInOutput || 0;
                return bytesB - bytesA;
            });

            const primaryInput = sortedInputs[0];

            // Convert to importPath format: '/abs/path/src/pages/test.ts' -> './pages/test'
            if (primaryInput.includes('/src/')) {
                const importPath = primaryInput
                    .substring(primaryInput.indexOf('/src/') + 4) // Remove everything before /src/
                    .replace(/^\//, './')                          // Ensure ./ prefix
                    .replace(/\.(ts|tsx|js|jsx)$/, '');            // Remove extension

                newManifest.set(importPath, relativePath);
                console.log(`${importPath} -> ${relativePath}`);
            }
        }
    }

    chunkManifest = newManifest;
    console.log(newManifest);
    return true;

    return true;
}

// Initial build
await build();
console.log('Initial build complete');

// Watch for changes
watch('./src', { recursive: true }, (eventType, filename) => {
    console.log(`File changed: ${filename}, rebuilding...`);
    build();
});

const server = Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Try to serve static files first
        const file = Bun.file('.' + path);
        if (await file.exists()) {
            return new Response(file);
        }

        // Check if the path matches a valid route and collect chunks
        const urlPath = path + url.search;
        const chunks = router.getChunksForUrl(urlPath);

        if (chunks !== null) {
            // Route matched - log chunks for debugging
            if (chunks.length > 0) {
                console.log(`Route ${path} requires chunks:`, chunks);
            }
            // Serve index.html for valid routes (SPA)
            // Later: inline chunks in import map based on chunks array
            return new Response(Bun.file('./index.html'));
        }

        // 404 for invalid routes
        return new Response('Not Found', { status: 404 });
    }
});

console.log(`Serving on http://localhost:${server.port}`);
