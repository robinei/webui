# CLAUDE.md

## Build & Development

- **Dev server:** `bun server.ts` — builds, watches, serves on http://localhost:3000
- **Tests:** structured suite in `src/pages/tests/` (navigate to /tests in browser); inline `console.assert()` calls in `util.ts` and `routing.ts` auto-run on load
- **No linter, no formatter, no package.json** — Bun, zero external dependencies

## Key Files

- `src/core.ts` — framework: Component, reactivity, lifecycle, control flow, For, VirtualList
- `src/observable.ts` — Observable/Signal/Computed/Effect reactive graph
- `src/routing.ts` — type-safe History API router
- `src/css.ts` — scoped CSS via `css()`
- `src/util.ts` — Levenshtein, ThinVec, memoFilter, createDirtyTracker, async primitives
- `server.ts` — Bun dev server with import-map-based code splitting

## Core Concepts

**`Value<T> = T | (() => T) | Observable<T>`** — the reactivity primitive. Static values used directly; thunks re-evaluated on update walks; Observables subscribe via Effects.

**`Component<N>`** owns one DOM node or null. Null components (`If`, `For`, `Route`, …) are logical grouping nodes that delegate DOM ops to children. Every component has parent/child/sibling pointers.

**Full-tree update model:** `updateRoot()` walks the entire tree re-evaluating all thunks. Tree size scales with what's on screen. Targeted updates can be layered on but aren't the default.

**Mutable state:** objects are mutated in place; thunks peek at mutable fields. `===` on primitives gives natural change detection. No immutable copying, no deep-equality overhead.

**Observable graph** (`src/observable.ts`): `Signal` (writable), `Computed` (derived, lazy), `Effect` (side-effecting). Auto-tracks dependencies during `.get()`. `batchEffects()` defers effect runs. For components, `addObservableEffect` wires an Effect into the component lifecycle.

## Patterns

Pages are functions returning `FragmentItem`. State in local variables, thunks for reactivity:

```typescript
let count = 0;
return div(
    DynamicText(() => `Count: ${count}`),
    button('Increment', { onclick() { count++; this.updateRoot(); } })
);
```

Event handlers receive `this` as `Component<N>` — `this.updateRoot()` re-renders, `this.node` is the DOM element.

**`For` with mutable items** — items are mutable objects; thunks inside peek at their fields:

```typescript
For(items, item => div(span(() => item.title)), item => item.id)
```

**Caching:** `memoFilter(source, predicate)` (array or thunk source only — not Observable; use `Computed` for that) for filtered views with zero allocation on the fast path. `createDirtyTracker()` for mutation-path invalidation of expensive derived state.

**`toGetter(value: Value<T>): () => T`** — normalizes any Value to a thunk.
**`getValue(value: Value<T>): T`** — eagerly evaluates any Value.

## Control Flow

- **`If`** — eager: both branches created upfront, one attached. Wrap expensive branches in `Lazy`.
- **`When`/`Unless`** — single-branch show/hide.
- **`With`** — **anti-pattern**: destroys/recreates subtree on every value change. Use mutable objects + thunks instead.
- **`Lazy`** — defers content until first mount. **`Transient`** — recreates on every mount.
- **`Match`** — multi-branch switch on a primitive value.

## CSS

Two systems:
- `css(sheet)` at module level — hashed class names, injected once, supports `&:hover`, `@media`, descendants
- `style: { prop: value }` attribute — reactive inline styles, re-evaluated per update

Both coexist; `className` accepts `Value<string>` so reactive class names work as thunks.
