# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

- **Dev server:** `bun server.ts` — builds, watches for changes, and serves on http://localhost:3000.
- **No test runner** — tests are inline `console.assert()` calls in `util.ts` and `routing.ts` that run automatically when modules load. Check the browser console for failures.
- **No linter or formatter configured.**
- **No package.json** — this project uses Bun directly with zero external dependencies.

## Architecture

This is a **custom reactive component framework** for building web UIs, written entirely from scratch in TypeScript (~2700 LOC).

### Server (`server.ts`)

A Bun-based dev server that builds, watches, and serves the app. Key behavior:

- **Build:** Uses `Bun.build()` with code splitting (`splitting: true`), linked sourcemaps, and `publicPath: '/build/'` so inter-chunk imports use absolute paths.
- **Metafile-driven manifest:** After each build, parses the metafile to map route `importPath` values (e.g. `./pages/test`) to output chunk files, walking transitive static deps.
- **Inline HTML generation:** No static `index.html`. The server generates HTML per-request with:
  - An **import map** using `data:` URLs for all chunks needed by the matched route (entry deps + route-specific chunks), with bare specifier keys (required because `data:` URLs lack a hierarchical base for URL resolution). Non-inlined chunks (other routes) get bare specifier → URL path mappings for lazy SPA loading.
  - The **entry point** inlined as `<script type="module">`.
  - **Stylesheets** (`bahunya.min.css` + `styles.css`) embedded as `<style>`.
- **Loading model:** Initial page load is a single HTTP response with everything inlined. SPA navigation loads one chunk per new route on first visit.
- **Source maps:** Linked `.map` files served from `/build/`. `//# sourceURL` directives give data URL modules clean paths in `Error.stack`. `//# sourceMappingURL` rewritten to absolute URLs so browsers can fetch maps from data URL module contexts.
- **Percent encoding for data URLs:** Encodes `%`, `\t`, `\n`, `\r`, `#` (structurally required), plus all non-ASCII as UTF-8 byte sequences via `encodeURIComponent`. `charset=utf-8` on the MIME type.

### Core (`src/core.ts`)

The framework centers on a `Component<N>` class that wraps a DOM node and manages a tree via parent/child/sibling pointers. Key concepts:

- **`Value<T> = T | (() => T)`** — the reactivity primitive. Static values are used directly; function values (thunks) are re-evaluated on updates. Components track value watchers and propagate changes through the tree.
- **`FragmentItem`** — recursive type that components accept as content: primitives, components, or nested arrays thereof.
- **`HTML` proxy** — a Proxy object that dynamically creates element constructors: `HTML.div(attrs, ...children)`. Attributes are typed per-element (`Attributes<N>`) including properties, event handlers (with `this` rebound to `Component<N>`), styles, and lifecycle hooks (`onmount`, `onmounted`, `onupdate`, `onunmount`).
- **`Context<T>`** — dependency injection via tree traversal, consumed with `context.Consume(value => ...)`.

Built-in control flow components: `If`/`When`/`Unless`/`Match` (conditional), `For`/`Repeat` (iteration with Levenshtein-based DOM reconciliation), `Suspense`/`Lazy`/`Async`/`Transient` (async loading), `VirtualList` (windowed list rendering), `ErrorBoundary` (error handling).

### Routing (`src/routing.ts`)

Type-safe URL routing built on the History API:

- **`Router`** extends `Route` — mounted on a DOM node, manages navigation.
- **Route specs** use typed parameters: `/prefs/name:string`, `/users/:id:number`. The `ParseUrlSpec` type extracts parameter types at compile time.
- **`route.subRoute(spec, handler)`** — defines nested routes. Handlers can be async for code splitting. Options include `importPath` for chunk manifest mapping.
- **`route.Link(attrs, ...content)`** — creates `<a>` elements with proper navigation.
- **`Outlet()`** — renders the matched child route's content.
- **`router.getChunksForUrl(url)`** — server-side: matches a URL and returns the `importPath` values for all matched routes (used by `server.ts` to determine which chunks to inline).

### Utilities (`src/util.ts`)

- `calcLevenshteinOperations()` — used by `For` and `replaceChildren` for efficient list reconciliation
- `deepEqual()` / `arraysEqual()` / `objectsEqual()` — change detection
- `Deferred<T>`, `Semaphore`, `memoizeThunk()` — async primitives
- `ThinVec<T>` — zero-allocation wrapper for 0-1 element arrays
- `createDirtyTracker()` — generation-counter based lazy caching for expensive derived state

### Pages (`src/pages/`)

Demo/test pages: `test.ts` (interactive component showcase), `todo.ts` (todo app), `bench.ts` (performance benchmarks), `prefs.ts` (nested routing example), `virtual.ts` (VirtualList demo with 10k items). Entry point is `src/index.ts` which defines routes and mounts the router.

## Design Philosophy

### Mutable State Model

The framework is intentionally built around **mutable state**. Objects are mutated in place, and thunks peek at mutable fields during updates. This is a deliberate choice — immutable state models have overhead (copying, deep equality checks) that can be avoided when the framework's update model supports mutation directly.

`===` on primitives (strings, numbers, booleans) inside thunks provides natural change detection. For complex derived state, use `memoFilter` (read-path caching) or `createDirtyTracker` (mutation-path caching).

### Full-Tree Update Model

`updateRoot()` walks the entire component tree, re-evaluating all thunks. This works because:
- Tree size scales with what's on screen, not with total data size
- A few hundred value watchers re-evaluating simple thunks is cheap (~microseconds)
- No dependency tracking overhead, no subscription management, no memory leaks from stale subscriptions

If targeted updates ever become necessary, they can be layered on via a Flux-like pattern or dirty tracking, but the full-tree walk is the designed default.

### Zero-or-One DOM Node per Component

Every `Component<N>` owns either one DOM node or null. Null components (`If`, `For`, `Route`, etc.) are logical grouping nodes that participate in the component tree but delegate DOM operations to their children.

## Patterns

Pages are functions returning `FragmentItem`. State is held in local variables with thunks providing reactivity:

```typescript
let count = 0;
return div(
    DynamicText(() => `Count: ${count}`),
    button('Increment', { onclick() { count++; this.updateRoot(); } })
);
```

Event handlers use `this` to access the `Component` instance — `this.updateRoot()` triggers a re-render of the tree, `this.node` accesses the underlying DOM element.

### For and Mutable Items

`For` takes items directly (not via getItem thunks). Items should be mutable objects; thunks inside the render function peek at their mutable fields:

```typescript
const items: TodoItem[] = [...];
For(items, item => div(
    span(() => item.title),  // thunk peeks at mutable field
    span(() => item.done.toString()),
), item => item.id);
```

The key function is used for Levenshtein-based reconciliation. The inline key comparison avoids allocation on the fast path (no `items.map(keyOf)`).

### Caching Primitives

**`memoFilter(source, predicate)`** — for read-path caching of filtered views. Returns a thunk that walks the source array and compares against the previous result, returning the cached array if unchanged. Zero allocation on the fast path:

```typescript
const todoItems = memoFilter(items, i => !i.done);
const doneItems = memoFilter(items, i => i.done);
// In render: For(todoItems, ...)
```

**`createDirtyTracker()`** — for mutation-path caching of expensive derived state. Uses a generation counter; `invalidate()` on mutation, `derived()` creates lazily-recomputed values:

```typescript
const tracker = createDirtyTracker();
const expensiveResult = tracker.derived(() => computeExpensiveThing(data));
// On mutation: tracker.invalidate();
// On read: expensiveResult() — recomputes only if generation changed
```

### Control Flow Components

- **`If`** evaluates both branches eagerly (DOM is created for both, only one is attached). This avoids forcing thunks on branches, keeping the API clean. Use `Lazy` to wrap expensive branches that should defer creation.
- **`When`/`Unless`** — show/hide a single branch (not two-branch conditional).
- **`With`** is an **anti-pattern** in the mutable model — it destroys and recreates its subtree on every value change, which fights the framework's design of stable component trees with mutable data.
- **`Lazy`/`Transient`** — `Lazy` defers content creation until first mount; `Transient` recreates content on every mount. Both participate in `Suspense` boundaries.
- **`Unsuspense`** — installs a no-op suspense handler to isolate a subtree from parent `Suspense` boundaries.

### VirtualList

Renders only the visible window of a large list, reusing keyed component fragments:

```typescript
VirtualList({
    items,
    itemSize: 36,           // px per item (height for vertical, width for horizontal)
    direction: 'vertical',  // or 'horizontal'
    buffer: 3,              // extra items rendered beyond viewport
    render: item => div(span(() => item.name)),
    key: item => item.id,
}).setStyle({ height: '400px' })  // container MUST have explicit size
```

The container must have an explicit height (vertical) or width (horizontal), otherwise `clientHeight`/`clientWidth` is 0 and only buffer items render.
