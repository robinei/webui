## BFF + Client Monorepo Architecture

**One codebase, one build, one request, zero roundtrips.**

### Route Definitions

A single route file importable by both server and client. Each route declares its page component and its data loader side by side:

```ts
// src/routes.ts
export const routes = {
  "/":              { page: () => import("./pages/home.tsx"),      data: () => import("./data/home.ts") },
  "/about":         { page: () => import("./pages/about.tsx"),     data: () => import("./data/about.ts") },
  "/users/:id":     { page: () => import("./pages/user.tsx"),      data: () => import("./data/user.ts") },
  "/dashboard":     { page: () => import("./pages/dashboard.tsx"), data: () => import("./data/dashboard.ts") },
} as const;
```

Data loaders and page components share types. The loader's return type is the component's input type:

```ts
// src/data/dashboard.ts
export async function load(params: RouteParams, cookies: Cookies): Promise<DashboardData> {
  const [user, stats] = await Promise.all([fetchUser(cookies.session), fetchStats(params.range)]);
  return { user, stats };
}

// src/pages/dashboard.tsx
export function render(data: DashboardData, root: Element) { ... }
```

Adding a route means adding one line to `routes.ts` and writing the page + data modules. Nothing else changes.

### Build

Single Bun build with one entrypoint. All routes use dynamic `import()`. Splitting extracts shared code into common chunks. `publicPath` ensures absolute URLs so inter-chunk imports work from data URIs. The metafile is processed into a manifest mapping routes to their transitive chunk dependencies.

```ts
const result = await Bun.build({
  entrypoints: ["./src/app.tsx"],
  outdir: "./dist",
  splitting: true,
  minify: true,
  target: "browser",
  publicPath: "/dist/",
  metafile: true,
});
// Post-process metafile → route-to-chunks manifest
```

### Serve

The BFF imports the same route definitions as the client. Route matching logic is written once — parameterized routes, wildcards, nesting all defined in one place. The BFF matches the URL, calls the route's data loader with URL params and cookies, then serves a single HTML response containing:

1. An **import map** redirecting the current route's critical chunks to percent-encoded `data:` URIs — inlining them in the HTML
2. The route's **JSON data** in a `<script type="application/json">` tag
3. A `<script type="module">` pointing at the app entrypoint

```html
<script type="importmap">
{
  "imports": {
    "/dist/app-x1y2.js": "data:text/javascript,...",
    "/dist/chunks/framework-c3d4.js": "data:text/javascript,...",
    "/dist/chunks/about-e5f6.js": "data:text/javascript,..."
  }
}
</script>
<script id="__DATA__" type="application/json">{"user":"robin",...}</script>
<script type="module" src="/dist/app-x1y2.js"></script>
```

The browser resolves all imports through the import map, hits data URIs, executes everything immediately. **Zero additional network requests for first render.**

The BFF itself is entirely generic and never needs modification when routes are added:

```ts
import { routes } from "./routes.ts";
import { match } from "./router.ts";
import { buildImportMap } from "./manifest.ts";

Bun.serve({
  async fetch(req) {
    const url = new URL(req.url);
    const [route, params] = match(url.pathname, routes);
    if (!route) return new Response("Not found", { status: 404 });

    const dataModule = await route.data();
    const data = await dataModule.load(params, parseCookies(req));
    const importMap = buildImportMap(url.pathname);

    return new Response(renderShell(importMap, data), {
      headers: { "content-type": "text/html" },
    });
  }
});
```

### Client-side navigation

The app is a full SPA after first load. The client imports the same route definitions and uses the same matching logic. User clicks a link, the router intercepts it, fetches the next route's JSON from the BFF, and `import()`s the route's page chunk. That chunk loads from a real URL (not in the import map), gets HTTP-cached normally, and renders from the fetched JSON.

### Version skew

The client sends a build hash with every fetch request. If the BFF sees a mismatch, it returns a well-known response and the client reloads to get the fresh version.

### Shared contracts

BFF and client live in the same repo, share the same route definitions, the same types, and the same matching logic. The JSON contract between data loaders and page components is just a TypeScript type — an internal implementation detail with no versioning. Both artifacts come from the same commit. Change the shape of a data loader's return type and the compiler tells you everywhere that breaks.

### Key properties

- **First load**: single HTTP request, all JS and data inlined via import map data URIs, full interactivity immediate
- **Navigation**: client-side, one JSON fetch + one lazy chunk load (if not already cached)
- **No SSR, no hydration, no framework runtime on the server**
- **No handoff problem**: the app boots the same way whether you arrived by server load or client navigation
- **Single route definition**: matching, data dependencies, and page components declared once, used by both server and client
- **Generic BFF**: server code never changes when routes are added — just define the route and write the modules
- **Full type safety**: data loader return types flow into page component props, enforced at build time
- **Build is trivial**: one `Bun.build` call + a manifest generation script
- **Chunks are properly cached** across client-side navigations, and re-inlined on full page loads so HTTP caching isn't needed for the critical path