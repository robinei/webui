import { Component, onQueryBind } from './core';
import { Signal, Computed, Observable } from './observable';

export interface QueryOptions<K = void> {
    staleTime?: number;          // ms before data is stale (default 0 = always SWR)
    gcTime?: number;             // ms to keep entry after last bind() unmounts (default 5min)
    cacheKey?: (k: K) => string; // default JSON.stringify
}

export type QueryHandle<T> = Component<null> & {
    readonly data: Observable<T | undefined>;
    readonly error: Observable<unknown>;
    readonly loading: Observable<boolean>;
};

interface QueryCacheEntry<T> {
    data: Signal<T | undefined>;
    error: Signal<unknown>;
    loading: Signal<boolean>;
    fetchedAt: number;
    inflight: Promise<void> | null;
    refCount: number;
    gcTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_GC_TIME = 5 * 60 * 1000;
const DEFAULT_STALE_TIME = 0;

function createEntry<T>(): QueryCacheEntry<T> {
    return {
        data: new Signal<T | undefined>(undefined),
        error: new Signal<unknown>(undefined),
        loading: new Signal(false),
        fetchedAt: 0,
        inflight: null,
        refCount: 0,
        gcTimer: null,
    };
}

export function createQueryEntry<T = unknown>(): QueryCacheEntry<T> {
    return createEntry<T>();
}

function resetEntry<T>(entry: QueryCacheEntry<T>): void {
    entry.data.set(undefined);
    entry.error.set(undefined);
    entry.loading.set(false);
    entry.fetchedAt = 0;
    entry.gcTimer = null;
}

function applyHydration<T>(entry: QueryCacheEntry<T>, val: { data: unknown; error: unknown; fetchedAt: number }): void {
    entry.data.set(val.data as T | undefined);
    entry.error.set(val.error);
    entry.fetchedAt = val.fetchedAt;
}

function runFetch<T>(
    component: Component<null>,
    entry: QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    staleTime: number,
    isMounted: () => boolean,
): void {
    const hasData = entry.data.get() !== undefined;
    const isFresh = hasData && (staleTime === Infinity ||
        (entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < staleTime));

    if (isFresh) return;

    if (hasData) {
        // SWR: serve stale data, refetch silently in background
        if (entry.inflight) return;
        entry.loading.set(true);
        entry.inflight = fetcher()
            .then(data => { entry.data.set(data); entry.fetchedAt = Date.now(); })
            .catch(err => { entry.error.set(err); })
            .finally(() => {
                entry.loading.set(false);
                entry.inflight = null;
                if (isMounted()) component.updateRoot();
            });
    } else {
        // No data: suspend via trackAsyncLoad (Suspense integration)
        component.trackAsyncLoad(async function runQueryFetch() {
            if (!entry.inflight) {
                entry.loading.set(true);
                entry.inflight = fetcher()
                    .then(data => { entry.data.set(data); entry.fetchedAt = Date.now(); })
                    .catch(err => { entry.error.set(err); })
                    .finally(() => { entry.loading.set(false); entry.inflight = null; });
            }
            await entry.inflight; // always resolves — errors stored in entry.error signal
        });
    }
}

function onMount<T>(
    component: Component<null>,
    entry: QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    staleTime: number,
    isMounted: () => boolean,
): void {
    entry.refCount++;
    if (entry.gcTimer !== null) {
        clearTimeout(entry.gcTimer);
        entry.gcTimer = null;
    }
    runFetch(component, entry, fetcher, staleTime, isMounted);
}

function onUnmount<T>(entry: QueryCacheEntry<T>, gcTime: number, onGC: () => void): void {
    if (--entry.refCount === 0) {
        if (gcTime === 0) {
            onGC();
        } else if (gcTime !== Infinity) {
            entry.gcTimer = setTimeout(onGC, gcTime);
        }
    }
}

function attachHandle<T>(
    component: Component<null>,
    data: Observable<T | undefined>,
    error: Observable<unknown>,
    loading: Observable<boolean>,
): QueryHandle<T> {
    Object.defineProperty(component, 'data', { value: data, enumerable: true });
    Object.defineProperty(component, 'error', { value: error, enumerable: true });
    Object.defineProperty(component, 'loading', { value: loading, enumerable: true });
    return component as QueryHandle<T>;
}


// ─── Query<T> ────────────────────────────────────────────────────────────────

// Registry for singleton Query entries (client-side hydration)
const queryRegistry = new Map<string, QueryCacheEntry<unknown>>();

// Pending hydration payload from server-side prefetch
let pendingHydration: Record<string, { data: unknown; error: unknown; fetchedAt: number }> | null = null;

export class Query<T> {
    readonly data: Signal<T | undefined>;
    readonly error: Signal<unknown>;
    readonly loading: Signal<boolean>;

    private readonly _id: string;
    private readonly _entry: QueryCacheEntry<T>;
    private readonly _fetcher: () => Promise<T>;
    private readonly _staleTime: number;
    private readonly _gcTime: number;

    constructor(id: string, fetcher: () => Promise<T>, options?: QueryOptions) {
        this._id = id;
        this._fetcher = fetcher;
        this._staleTime = options?.staleTime ?? DEFAULT_STALE_TIME;
        this._gcTime = options?.gcTime ?? DEFAULT_GC_TIME;
        this._entry = createEntry<T>();
        this.data = this._entry.data;
        this.error = this._entry.error;
        this.loading = this._entry.loading;
        queryRegistry.set(id, this._entry as QueryCacheEntry<unknown>);
        // Apply any pending hydration that arrived before this constructor ran
        const hydration = pendingHydration?.[id];
        if (hydration) { applyHydration(this._entry, hydration); delete pendingHydration![id]; }
    }

    bind(): QueryHandle<T> {
        const id = this._id;
        let mounted = false;
        const component = new Component<null>(null, 'Query');

        component.addMountListener(() => {
            mounted = true;
            const effectiveEntry = (onQueryBind?.(component, id) as QueryCacheEntry<T> | null)
                ?? this._entry;
            // Apply pending hydration for this entry (server path: effectiveEntry is per-request)
            const hydration = pendingHydration?.[id];
            if (hydration && effectiveEntry !== this._entry) {
                applyHydration(effectiveEntry, hydration);
            }
            onMount(component, effectiveEntry, this._fetcher, this._staleTime, () => mounted);
        });
        component.addUnmountListener(() => {
            mounted = false;
            onUnmount(this._entry, this._gcTime, () => resetEntry(this._entry));
        });

        return attachHandle(component, this._entry.data, this._entry.error, this._entry.loading);
    }

    async refetch(): Promise<void> {
        const entry = this._entry;
        if (entry.inflight) return entry.inflight;
        entry.loading.set(true);
        entry.inflight = this._fetcher()
            .then(data => { entry.data.set(data); entry.fetchedAt = Date.now(); })
            .catch(err => { entry.error.set(err); })
            .finally(() => { entry.loading.set(false); entry.inflight = null; });
        return entry.inflight;
    }

    invalidate(): void {
        this._entry.fetchedAt = 0;
    }

    clear(): void {
        resetEntry(this._entry);
    }
}


// ─── createQueryFamily<K, T> ─────────────────────────────────────────────────

export type QueryFamily<K, T> = {
    signal(key: K): Signal<T | undefined>;
    bind(key: K): QueryHandle<T>;
    bind(key: Observable<K>): QueryHandle<T>;
    invalidate(key: K): void;
    clear(key: K): void;
};

export function createQueryFamily<K, T>(
    id: string,
    fetcher: (key: K) => Promise<T>,
    options?: QueryOptions<K>,
): QueryFamily<K, T> {
    const staleTime = options?.staleTime ?? DEFAULT_STALE_TIME;
    const gcTime = options?.gcTime ?? DEFAULT_GC_TIME;
    const toCacheKey: (k: K) => string = options?.cacheKey ?? (k => JSON.stringify(k));
    const cache = new Map<string, QueryCacheEntry<T>>();

    function getOrCreateClient(ck: string): QueryCacheEntry<T> {
        let entry = cache.get(ck);
        if (!entry) {
            entry = createEntry<T>();
            cache.set(ck, entry);
            // Apply pending hydration
            const hydration = pendingHydration?.[`${id}:${ck}`];
            if (hydration) { applyHydration(entry, hydration); delete pendingHydration![`${id}:${ck}`]; }
        }
        return entry;
    }

    function doGC(entry: QueryCacheEntry<T>, ck: string): void {
        resetEntry(entry);
        cache.delete(ck);
    }

    function bindConcrete(key: K): QueryHandle<T> {
        const ck = toCacheKey(key);
        const globalKey = `${id}:${ck}`;
        let mounted = false;
        const component = new Component<null>(null, 'Query');

        if (!onQueryBind) {
            // Client path: get entry now, attach signals directly (zero overhead)
            const entry = getOrCreateClient(ck);
            component.addMountListener(() => { mounted = true; onMount(component, entry, () => fetcher(key), staleTime, () => mounted); });
            component.addUnmountListener(() => { mounted = false; onUnmount(entry, gcTime, () => doGC(entry, ck)); });
            return attachHandle(component, entry.data, entry.error, entry.loading);
        }

        // Server path: defer entry to mount, use dummy signals (server never reads them)
        component.addMountListener(() => {
            mounted = true;
            const entry = onQueryBind!(component, globalKey) as QueryCacheEntry<T>;
            onMount(component, entry, () => fetcher(key), staleTime, () => mounted);
        });
        component.addUnmountListener(() => { mounted = false; /* per-request entry; no GC needed */ });
        const dummy = createEntry<T>();
        return attachHandle(component, dummy.data, dummy.error, dummy.loading);
    }

    function bindObservable(keyObs: Observable<K>): QueryHandle<T> {
        const currentEntrySignal = new Signal<QueryCacheEntry<T> | null>(null);
        let currentEntry: QueryCacheEntry<T> | null = null;
        let currentCk: string | null = null;
        let mounted = false;

        const component = new Component<null>(null, 'Query');

        component.addMountListener(function onQueryMount() { mounted = true; });

        component.addValueWatcher(keyObs, function onKeyChanged(key: K) {
            if (currentEntry !== null && currentCk !== null) {
                const prev = currentEntry, prevCk = currentCk;
                onUnmount(prev, gcTime, () => doGC(prev, prevCk));
            }
            const ck = toCacheKey(key);
            const globalKey = `${id}:${ck}`;
            currentEntry = (onQueryBind?.(component, globalKey) as QueryCacheEntry<T> | null)
                ?? getOrCreateClient(ck);
            currentCk = ck;
            currentEntrySignal.set(currentEntry);
            onMount(component, currentEntry, () => fetcher(key), staleTime, () => mounted);
        });

        component.addUnmountListener(function onQueryUnmount() {
            mounted = false;
            if (currentEntry !== null && currentCk !== null) {
                const entry = currentEntry, ck = currentCk;
                onUnmount(entry, gcTime, () => doGC(entry, ck));
                currentEntry = null;
                currentCk = null;
                currentEntrySignal.set(null);
            }
        });

        // Computeds read via currentEntrySignal — tracked dependency ensures re-evaluation on mount/key change
        const data = new Computed<T | undefined>(() => currentEntrySignal.get()?.data.get() ?? undefined);
        const error = new Computed<unknown>(() => currentEntrySignal.get()?.error.get());
        const loading = new Computed<boolean>(() => currentEntrySignal.get()?.loading.get() ?? false);

        return attachHandle(component, data, error, loading);
    }

    return {
        signal(key: K): Signal<T | undefined> {
            return getOrCreateClient(toCacheKey(key)).data;
        },

        bind(key: K | Observable<K>): QueryHandle<T> {
            if (key instanceof Observable) return bindObservable(key);
            return bindConcrete(key as K);
        },

        invalidate(key: K): void {
            const entry = cache.get(toCacheKey(key));
            if (entry) entry.fetchedAt = 0;
        },

        clear(key: K): void {
            const ck = toCacheKey(key);
            const entry = cache.get(ck);
            if (entry) doGC(entry, ck);
        },
    };
}


// ─── Serialization ───────────────────────────────────────────────────────────

export function serializeQueryCache(
    cache: Map<string, QueryCacheEntry<unknown>>
): Record<string, { data: unknown; error: unknown; fetchedAt: number }> {
    const out: Record<string, any> = {};
    for (const [key, entry] of cache) {
        if (entry.fetchedAt > 0)
            out[key] = { data: entry.data.get(), error: entry.error.get(), fetchedAt: entry.fetchedAt };
    }
    return out;
}


// ─── Hydration ───────────────────────────────────────────────────────────────

export function hydrateQueryCache(payload: Record<string, { data: unknown; error: unknown; fetchedAt: number }>): void {
    pendingHydration = { ...payload };
    // Eagerly apply to already-registered Query singletons
    for (const [key, val] of Object.entries(pendingHydration)) {
        if (key.includes(':')) continue; // family entry — applied lazily in getOrCreateClient
        const entry = queryRegistry.get(key);
        if (entry) { applyHydration(entry, val); delete pendingHydration[key]; }
    }
    if (Object.keys(pendingHydration).length === 0) pendingHydration = null;
}
