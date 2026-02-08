# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

- **Build (watch mode):** `./build.sh` — runs `bun --watch build --outdir=./build --target=browser --sourcemap=inline src/index.ts`
- **Dev server:** `python serve.py` — serves on http://localhost:3000, with SPA fallback (404→index.html). Use `--slow` to add 1s delay per request for debugging loading concurrency.
- **No test runner** — tests are inline `console.assert()` calls in `util.ts` and `routing.ts` that run automatically when modules load. Check the browser console for failures.
- **No linter or formatter configured.**
- **No package.json** — this project uses Bun directly with zero external dependencies.

## Architecture

This is a **custom reactive component framework** for building web UIs, written entirely from scratch in TypeScript (~2700 LOC).

### Core (`src/core.ts`)

The framework centers on a `Component<N>` class that wraps a DOM node and manages a tree via parent/child/sibling pointers. Key concepts:

- **`Value<T> = T | (() => T)`** — the reactivity primitive. Static values are used directly; function values (thunks) are re-evaluated on updates. Components track value watchers and propagate changes through the tree.
- **`FragmentItem`** — recursive type that components accept as content: primitives, components, or nested arrays thereof.
- **`HTML` proxy** — a Proxy object that dynamically creates element constructors: `HTML.div(attrs, ...children)`. Attributes are typed per-element (`Attributes<N>`) including properties, event handlers (with `this` rebound to `Component<N>`), styles, and lifecycle hooks (`onmount`, `onmounted`, `onupdate`, `onunmount`).
- **`Context<T>`** — dependency injection via tree traversal, consumed with `context.Consume(value => ...)`.

Built-in control flow components: `If`/`When`/`Unless`/`Match` (conditional), `For`/`Repeat` (iteration with Levenshtein-based DOM reconciliation), `Suspense`/`Lazy`/`Async`/`Transient` (async loading), `ErrorBoundary` (error handling).

### Routing (`src/routing.ts`)

Type-safe URL routing built on the History API:

- **`Router`** extends `Route` — mounted on a DOM node, manages navigation.
- **Route specs** use typed parameters: `/prefs/name:string`, `/users/:id:number`. The `ParseUrlSpec` type extracts parameter types at compile time.
- **`route.subRoute(spec, handler)`** — defines nested routes. Handlers can be async for code splitting.
- **`route.Link(attrs, ...content)`** — creates `<a>` elements with proper navigation.
- **`Outlet()`** — renders the matched child route's content.

### Utilities (`src/util.ts`)

- `calcLevenshteinOperations()` — used by `For` component for efficient list reconciliation
- `deepEqual()` / `arraysEqual()` / `objectsEqual()` — change detection
- `Deferred<T>`, `Semaphore`, `memoizeThunk()` — async primitives
- `ThinVec<T>` — zero-allocation wrapper for 0-1 element arrays

### Pages (`src/pages/`)

Demo/test pages: `test.ts` (interactive component showcase), `todo.ts` (todo app), `bench.ts` (performance benchmarks), `prefs.ts` (nested routing example). Entry point is `src/index.ts` which defines routes and mounts the router.

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
