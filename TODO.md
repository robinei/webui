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


## Normalized Caching + Optimistic Updates

Currently each query/family owns its own data independently. If two queries return the same User #5, updating one doesn't affect the other — you must manually `invalidate()` or `refetch()` stale queries.

### Architecture: Index-Based Invalidation

**Why not full normalization (Relay-style)?** Full normalization decomposes responses into flat entity signals and recomposes via Computeds. This conflicts with the framework's mutable-object + thunk model — query results would become immutable computed views. Index-based invalidation keeps `QueryCacheEntry` and plain mutable results untouched, and refetches instead of patching.

**EntityIndex** — a module-level registry mapping `(type, id) → Set<QueryCacheEntry>`, tracking which entities appear in which cache entries.

```
User#5 → [GetUser("5").entry, GetUsers.entry, SearchResults.entry]
Post#12 → [GetUser("5").entry, GetPosts.entry]
```

When an entity is updated (via mutation response or manual call), all entries referencing it are invalidated and refetched.

### Changes to `src/query.ts`

**EntityIndex** (module-level):
- `indexEntities(entry, refs)` — re-indexes an entry after fetch (removes old refs, adds new)
- `deindexEntry(entry)` — removes entry from all entity sets (on GC)
- `invalidateEntity(type, id)` — marks all entries containing this entity as stale
- `refetchEntity(type, id)` — invalidate + immediately refetch mounted entries

**Wire into existing code**:
- After successful `doFetch`: if query has an entity extractor, call `indexEntities`
- On `resetEntry` / GC: call `deindexEntry`
- New `entities` option on `QueryOptions`: `entities?: (data: T) => EntityRef[]`

**`mutate()` function** — optimistic updates with rollback:

```typescript
mutate({
    fetch: () => execute('/graphql', UpdateUser, { id, name }),
    optimistic: [
        { query: getUserFamily, key: id, patch: prev => ({ ...prev, user: { ...prev.user, name } }) },
    ],
    invalidate: [{ type: 'User', id }],
    // On success: all queries containing User #id refetch
    // On failure: optimistic patches rolled back
});
```

Optimistic patches target specific query entries directly (whole-result patching — the consumer knows their own data shape). Entity invalidation handles cross-query consistency after the mutation succeeds.

### Changes to `src/graphql.ts`

Make the selection tree walkable at runtime so entity extractors can be auto-generated from query definitions.

**Add runtime metadata to `GQLNode`**:
- `scalarKind?: 'id' | 'string' | 'int' | 'float' | 'boolean'` — set by `makeScalar`, tags what kind of scalar this is
- `children?: Record<string, GQLNode>` — set by `select()` and `union()`, exposes the field/branch map
- `inner?: GQLNode` — set by `list()`, `nullable()`, `field()`, `alias()`, `lazy()`, links to the wrapped node

Every combinator sets its own link:
- `select()`, `union()` → `children` (field/branch name → node)
- `list()`, `nullable()`, `field()`, `alias()` → `inner` (wrapped node)
- `lazy()` → getter on `inner` that resolves the thunk
- Scalars → leaf nodes, just `scalarKind`

**`entitiesFrom(op)`** — auto-generate an entity extractor by walking the selection tree:
- Find all `select()` nodes whose children include a field with `scalarKind === 'id'`
- Return a function that walks response data and collects `{ type, id }` for every matching object
- Type name derived from parent field name (capitalized): `user` → `"User"`, `posts` → `"Posts"`

```typescript
// Auto-generated:
const getUser = createQueryFamily('getUser', fetcher, { entities: entitiesFrom(GetUser) });

// Manual (always an option, no graphql.ts dependency):
const getUser = createQueryFamily('getUser', fetcher, {
    entities: (result) => [{ type: 'User', id: result.user.id }],
});
```

### Design decisions
- **No response decomposition/recomposition** — results stay as plain objects
- **No automatic patching from mutation responses** — uses invalidation + refetch instead (simpler, entity index infrastructure supports patching later if needed)
- **No GraphQL coupling in query.ts** — entity extractors are plain functions
- `entitiesFrom()` derives entity structure from the selection tree, not from the server schema


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
