#!/usr/bin/env bun

import { router } from './src/index';
import { watch } from 'fs';

// Map from importPath (e.g. './pages/test') to chunk URLs needed for that route
let chunkManifest = new Map<string, string[]>();
// Entry dep chunk URLs (always needed, go in import map)
let entryChunks: string[] = [];
// Entry point URL (its content is inlined as <script type="module">)
let entryUrl = '';
// All output file contents, keyed by URL path
let fileContents = new Map<string, string>();
// Inline styles
let stylesContent = '';

function toUrl(metaPath: string): string {
    // Strip leading ./ or ././ and prepend /build/
    return '/build/' + metaPath.replace(/^(\.\/)+/, '');
}

// Collect transitive static (import-statement) deps from outputs
function collectStaticDeps(
    outputs: Record<string, { imports: { path: string; kind: string }[] }>,
    path: string,
    seen: Set<string>
) {
    if (seen.has(path)) return;
    seen.add(path);
    const output = outputs[path];
    if (!output) return;
    for (const imp of output.imports) {
        if (imp.kind === 'import-statement') {
            collectStaticDeps(outputs, imp.path, seen);
        }
    }
}

// Percent-encode JS for data: URLs
// Must encode: % (escape char), # (fragment), \t \n \r (stripped by fetch spec)
function percentEncode(code: string): string {
    return code
        .replaceAll('%', '%25')
        .replaceAll('\t', '%09')
        .replaceAll('\n', '%0A')
        .replaceAll('\r', '%0D')
        .replaceAll('#', '%23')
        .replace(/[^\x20-\x7E]/gu, ch => encodeURIComponent(ch));
}

// "/build/chunk-asaryp1a.js" → "chunk-asaryp1a"
function toBareSpecifier(url: string): string {
    return url.split('/').pop()!.replace(/\.js$/, '');
}

// Rewrite /build/*.js import paths in JS source to bare specifiers.
// Bare specifiers bypass URL resolution (which fails for data: base URLs)
// and go straight to the import map.
function rewriteImports(code: string): string {
    // Only rewrite /build/xxx.js when followed by a quote (import specifiers).
    // Preserves sourceMappingURL=/build/xxx.js.map comments.
    return code.replace(/\/build\/([\w.-]+)\.js(?=["'])/g, '$1');
}

async function build() {
    const result = await Bun.build({
        entrypoints: ['./src/index.ts'],
        outdir: './build',
        target: 'browser',
        sourcemap: 'linked',
        splitting: true,
        naming: '[dir]/[name]-[hash].[ext]',
        metafile: true,
        publicPath: '/build/',
    });

    if (!result.success) {
        console.error('Build failed:', result.logs);
        return false;
    }

    if (!result.metafile) {
        console.warn('No metafile available');
        chunkManifest = new Map();
        entryChunks = [];
        entryUrl = '';
        fileContents = new Map();
        return true;
    }

    const { inputs, outputs } = result.metafile;

    // Find the entry point output
    let entryPath = '';
    for (const [outputPath, info] of Object.entries(outputs)) {
        if ((info as any).entryPoint === 'src/index.ts') {
            entryPath = outputPath;
            break;
        }
    }

    // Collect entry + transitive static deps
    const entryDepSet = new Set<string>();
    collectStaticDeps(outputs, entryPath, entryDepSet);

    entryUrl = toUrl(entryPath);
    // Entry deps = everything except the entry point itself (entry is inlined directly)
    entryChunks = [...entryDepSet].filter(p => p !== entryPath).map(toUrl);

    // Build route manifest from the entry point's dynamic imports
    const newManifest = new Map<string, string[]>();
    const entryInput = inputs['src/index.ts'];

    if (entryInput) {
        for (const imp of entryInput.imports) {
            if (imp.kind === 'dynamic-import' && imp.original) {
                if (newManifest.has(imp.original)) continue;

                const deps = new Set<string>();
                collectStaticDeps(outputs, imp.path, deps);
                for (const d of entryDepSet) deps.delete(d);

                newManifest.set(imp.original, [...deps].map(toUrl));
            }
        }
    }

    chunkManifest = newManifest;

    // Read all output files into memory
    const newContents = new Map<string, string>();
    for (const outputPath of Object.keys(outputs)) {
        const filePath = 'build/' + outputPath.replace(/^(\.\/)+/, '');
        try {
            const content = await Bun.file(filePath).text();
            newContents.set(toUrl(outputPath), content);
        } catch (e) {
            console.warn(`Could not read ${filePath}:`, e);
        }
    }
    fileContents = newContents;

    // Read and concatenate stylesheets
    const sheets: string[] = [];
    for (const path of ['bahunya.min.css', 'styles.css']) {
        try { sheets.push(await Bun.file(path).text()); } catch { }
    }
    stylesContent = sheets.join('\n');

    console.log('Entry:', entryUrl);
    console.log('Entry deps:', entryChunks);
    console.log('Route chunks:', Object.fromEntries(chunkManifest));
    return true;
}

function generateHtml(routeChunkUrls: string[], origin: string): string {
    const inlinedUrls = new Set([...entryChunks, ...routeChunkUrls]);

    // All chunk URLs (everything except the entry point itself)
    const allChunkUrls = [...fileContents.keys()].filter(u => u !== entryUrl);

    // Build import map with bare specifiers for ALL chunks.
    // - Inlined chunks: bare specifier → data: URL (+ path key → data: URL for fetched importers)
    // - Non-inlined chunks: bare specifier → URL path (fetched on demand by SPA navigation)
    const imports: Record<string, string> = {};

    for (const url of allChunkUrls) {
        const bare = toBareSpecifier(url);
        const content = fileContents.get(url)!;

        if (inlinedUrls.has(url)) {
            // Rewrite imports to bare specifiers, make sourceMappingURL absolute,
            // and add sourceURL so Error.stack shows clean paths instead of data: URLs
            let rewritten = rewriteImports(content)
                .replace(/\/\/# sourceMappingURL=(\S+)/, `//# sourceURL=${url}\n//# sourceMappingURL=${origin}$1`);
            const dataUrl = `data:application/javascript;charset=utf-8,${percentEncode(rewritten)}`;
            imports[bare] = dataUrl;  // for imports from data: URL modules
            imports[url] = dataUrl;   // for imports from fetched modules (hierarchical base)
        } else {
            imports[bare] = url;      // for imports from data: URL modules
        }
    }

    const importMap = JSON.stringify({ imports });
    const entryContent = rewriteImports(fileContents.get(entryUrl) || '');

    return `<!DOCTYPE html>
<html>
<head>
    <link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC">
    <style>${stylesContent}</style>
    <script type="importmap">${importMap}</script>
</head>
<body>
    <script type="module">${entryContent}</script>
</body>
</html>`;
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

        // Check if the path matches a valid route
        const urlPath = path + url.search;
        const importPaths = router.getChunksForUrl(urlPath);

        if (importPaths !== null) {
            // Resolve import paths to chunk URLs
            const routeChunks: string[] = [];
            const seen = new Set<string>();
            for (const importPath of importPaths) {
                const chunks = chunkManifest.get(importPath);
                if (chunks) {
                    for (const c of chunks) {
                        if (!seen.has(c)) {
                            seen.add(c);
                            routeChunks.push(c);
                        }
                    }
                }
            }

            return new Response(generateHtml(routeChunks, url.origin), {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        // 404 for invalid routes
        return new Response('Not Found', { status: 404 });
    }
});

console.log(`Serving on http://localhost:${server.port}`);
