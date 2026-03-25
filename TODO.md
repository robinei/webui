# TODO

## Streaming Query Prefetch

Currently the server waits for all queries to resolve before sending the HTML response. Queries are discovered by mounting routes on a fake DOM server-side, waiting for all async loads, then embedding `__QUERY_CACHE__` in a `<script>` tag.

**Improvement**: Send the HTML shell immediately (or after a short deadline), then stream remaining query results as they resolve.

### Approach: Chunked HTML with inline `<script>` tags

The server sends the initial HTML with whatever cache entries are ready. As remaining queries resolve, it appends `<script>` chunks to the response stream:

```html
<!-- Initial HTML sent immediately -->
<script>window.__QUERY_CACHE__ = { "key1": {...} }</script>
</body>
<!-- Streamed as queries resolve -->
<script>window.__QUERY_CACHE__["key2"] = {...}; window.__onQueryResult?.("key2")</script>
```

No special transport needed — the browser parses HTML incrementally. This is the same pattern used by Marko and Remix (BigPipe-style).

### What needs to change

- **server.ts**: Switch from `waitForAllQueries() → send()` to streaming response. Send HTML shell after a deadline (e.g. 50ms), then stream `<script>` chunks as queries complete. Close the response when all queries are done or a hard timeout is reached.
- **query.ts**: Add a `__onQueryResult` hook that the streamed scripts call. When a cache entry arrives, resolve the pending query and trigger Suspense resolution.
- **Suspense**: Already handles async resolution — just needs the query system to properly signal completion when streamed data arrives.


## Tree Shaking Markers

Add `/* @__PURE__ */` annotations to side-effect-free function calls and class instantiations so bundlers (esbuild, Rollup, Terser) can eliminate unused framework features.

Key targets:
- `css()` calls (pure if the result is unused)
- `new Component(...)` factory wrappers (`If`, `When`, `For`, `Match`, etc.)
- `new Signal()`, `new Computed()`, `new Effect()` wrappers
- `createComputedFamily()`, `observableProxy()`, `signalProxy()`

Also consider splitting core.ts (~2200 LOC) into separate modules (component, control-flow, virtual-list) so bundlers can drop entire subsystems if unused.


## Developer Tooling

No component tree inspector, no update logging, no way to visualize the reactive graph.

### Debug mode

A `debug` mode (enabled via flag or query param) that:
- Logs every `updateRoot()` call with the triggering component and duration
- Logs Effect evaluations and dependency changes
- Warns on suspiciously expensive update walks (e.g. >16ms)
- Highlights components that re-render frequently

### Component tree inspector

Browser extension or in-page overlay that:
- Shows the component tree with parent/child/sibling structure
- Displays component state (mounted, detached, suspense count, exit state)
- Shows the reactive dependency graph (which Signals/Computeds feed which Effects)
- Allows triggering `updateRoot()` on any component manually


## Accessibility

No `aria-*` attribute support in the type system, no focus management utilities.

### Type system

- Add `aria-*` attributes to `PropertyAttributes<N>` so they type-check and autocomplete.
- Add `role` attribute support.

### Utilities

- **Focus trap**: For modals/dialogs — trap Tab/Shift-Tab within a subtree, restore focus on unmount.
- **Focus management**: `focusFirst()`, `focusLast()`, restore-on-unmount pattern for route transitions.
- **Live regions**: Helper for `aria-live` announcements (e.g. "3 items remaining" after todo deletion).
- **Skip links**: Pattern/utility for keyboard navigation bypass.

### Patterns

- Document which HTML elements to use for interactive components (prefer `<button>` over `<div onclick>`).
- Document keyboard interaction patterns (Enter/Space for activation, Escape for dismissal).


## Error Observability

`injectError()` walks the parent chain to find a handler set via `setErrorHandler()`. If none found, logs to `console.error`. This is insufficient for production.

### Problems

- No global error hook — can't integrate with Sentry, Datadog, etc.
- No error context/metadata — can't attach component name, route, user info.
- Double errors in ErrorBoundary fallbacks are swallowed silently.
- Errors in unmount listeners are not surfaced.

### Proposed changes

- **Global error handler**: `setGlobalErrorHandler((error, context) => ...)` that catches all unhandled component errors. Context includes component name, parent chain, route.
- **Error metadata**: `errorContext()` API to attach key-value metadata that propagates with errors.
- **ErrorBoundary improvements**: If fallback itself throws, propagate to parent boundary instead of swallowing. Add `onError` callback for logging without replacing the UI.
