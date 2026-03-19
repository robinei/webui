import { Component, onQueryBind, type Value } from './core';
import { Signal, Computed, Observable, observableProxy, type ObservableProxy } from './observable';

export interface QueryOptions<K = void> {
    staleTime?: number;          // ms before data is stale (default 0 = always SWR)
    gcTime?: number;             // ms to keep entry after last bind() unmounts (default 5min)
    cacheKey?: (k: K) => string; // default JSON.stringify
    retry?: number;                           // max retry attempts on failure (default 0)
    retryDelay?: (attempt: number) => number; // ms to wait before each retry (default exponential backoff)
    refetchOnFocus?: boolean;                 // refetch stale data when tab regains focus (default true)
    refetchInterval?: number;                 // ms between automatic background polls (default 0 = off)
    keepPreviousData?: boolean;               // show prior data while new key's fetch is loading (default false)
}

export type QueryHandle<T> = Component<null> & {
    readonly data: ObservableProxy<NonNullable<T>>;
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
    onFetch: Set<() => void>;  // notified after every completed fetch
}

interface FetchPolicy {
    staleTime: number;
    gcTime: number;
    retry: number;
    retryDelay: (attempt: number) => number;
    refetchOnFocus: boolean;
    refetchInterval: number;  // 0 = disabled
    keepPreviousData: boolean;
}

const DEFAULT_GC_TIME = 5 * 60 * 1000;
const DEFAULT_STALE_TIME = 0;
const DEFAULT_RETRY_DELAY = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

function makeFetchPolicy(options?: QueryOptions<any>): FetchPolicy {
    return {
        staleTime:        options?.staleTime        ?? DEFAULT_STALE_TIME,
        gcTime:           options?.gcTime           ?? DEFAULT_GC_TIME,
        retry:            options?.retry            ?? 0,
        retryDelay:       options?.retryDelay       ?? DEFAULT_RETRY_DELAY,
        refetchOnFocus:   options?.refetchOnFocus   ?? true,
        refetchInterval:  options?.refetchInterval  ?? 0,
        keepPreviousData: options?.keepPreviousData ?? false,
    };
}

function createEntry<T>(): QueryCacheEntry<T> {
    return {
        data: new Signal<T | undefined>(undefined),
        error: new Signal<unknown>(undefined),
        loading: new Signal(false),
        fetchedAt: 0,
        inflight: null,
        refCount: 0,
        gcTimer: null,
        onFetch: new Set(),
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
    entry.inflight = null;
    entry.gcTimer = null;
}

function applyHydration<T>(entry: QueryCacheEntry<T>, val: { data: unknown; error: unknown; fetchedAt: number }): void {
    entry.data.set(val.data as T | undefined);
    entry.error.set(val.error);
    entry.fetchedAt = val.fetchedAt;
}

function doFetch<T>(
    entry: QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    retry: number,
    retryDelay: (attempt: number) => number,
): Promise<void> {
    if (entry.inflight) return entry.inflight;
    entry.loading.set(true);
    // `p` is captured in callbacks to detect if this fetch was superseded by resetEntry().
    let p!: Promise<void>;
    p = (async () => {
        for (let attempt = 0; ; attempt++) {
            try {
                const data = await fetcher();
                if (entry.inflight !== p) return;
                entry.data.set(data);
                entry.fetchedAt = Date.now();
                entry.error.set(undefined); // clear any prior error on success
                return;
            } catch (err) {
                if (entry.inflight !== p) return;
                if (attempt >= retry) { entry.error.set(err); return; }
                await new Promise<void>(resolve => setTimeout(resolve, retryDelay(attempt)));
                if (entry.inflight !== p) return; // cancelled during retry wait
            }
        }
    })().finally(() => {
        if (entry.inflight === p) { entry.loading.set(false); entry.inflight = null; for (const cb of entry.onFetch) cb(); }
    });
    entry.inflight = p;
    return p;
}

function runFetch<T>(
    component: Component<null>,
    entry: QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    policy: FetchPolicy,
): void {
    const hasData = entry.data.get() !== undefined;
    const isFresh = hasData && (policy.staleTime === Infinity ||
        (entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < policy.staleTime));

    if (isFresh) return;

    if (hasData) {
        // SWR: serve stale data, refetch silently in background
        doFetch(entry, fetcher, policy.retry, policy.retryDelay);
    } else {
        // No data: suspend via trackAsyncLoad (Suspense integration)
        // doFetch deduplicates if another component already started this fetch.
        // The promise always resolves (errors stored in entry.error signal, not thrown).
        component.trackAsyncLoad(async function runQueryFetch() {
            await doFetch(entry, fetcher, policy.retry, policy.retryDelay);
        });
    }
}

function onMount<T>(
    component: Component<null>,
    entry: QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    policy: FetchPolicy,
): void {
    entry.refCount++;
    if (entry.gcTimer !== null) {
        clearTimeout(entry.gcTimer);
        entry.gcTimer = null;
    }
    runFetch(component, entry, fetcher, policy);
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
    Object.defineProperty(component, 'data', { value: observableProxy(data as unknown as Observable<NonNullable<T> & object>), enumerable: true });
    Object.defineProperty(component, 'error', { value: error, enumerable: true });
    Object.defineProperty(component, 'loading', { value: loading, enumerable: true });
    return component as QueryHandle<T>;
}


// ─── Window-focus refetch ─────────────────────────────────────────────────────

const focusRefetchCallbacks = new Set<() => void>();
let focusListenerInstalled = false;

function ensureFocusListener(): void {
    if (focusListenerInstalled) return;
    focusListenerInstalled = true;
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible')
                for (const cb of focusRefetchCallbacks) cb();
        });
    }
}


// Single canonical implementation of client/server entry wiring for a concrete (non-observable) key.
// Client path: get entry eagerly, attach its signals directly to the handle (zero overhead on updates).
// Server path: defer entry lookup to mount (onQueryBind needs component.getRoot()), use dummy signals
//              (server never reads handle signals — only the per-request tracker.cache matters).
function bindConcreteEntry<T>(
    getClientEntry: () => QueryCacheEntry<T>,
    getServerEntry: (c: Component<null>) => QueryCacheEntry<T>,
    fetcher: () => Promise<T>,
    policy: FetchPolicy,
    onGC: (entry: QueryCacheEntry<T>) => void,
): QueryHandle<T> {
    const component = new Component<null>(null, 'Query');

    if (!onQueryBind) {
        const entry = getClientEntry();
        const updateCb = () => component.updateRoot();
        const focusCb = policy.refetchOnFocus
            ? () => runFetch(component, entry, fetcher, policy)
            : null;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        component.addMountListener(() => {
            entry.onFetch.add(updateCb);
            if (focusCb) { ensureFocusListener(); focusRefetchCallbacks.add(focusCb); }
            if (policy.refetchInterval > 0) {
                intervalId = setInterval(() => {
                    if (entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < policy.refetchInterval) return;
                    runFetch(component, entry, fetcher, policy);
                }, policy.refetchInterval);
            }
            onMount(component, entry, fetcher, policy);
        });
        component.addUnmountListener(() => {
            entry.onFetch.delete(updateCb);
            if (focusCb) focusRefetchCallbacks.delete(focusCb);
            if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
            onUnmount(entry, policy.gcTime, () => onGC(entry));
        });
        return attachHandle(component, entry.data, entry.error, entry.loading);
    }

    // Server path
    component.addMountListener(() => {
        const entry = getServerEntry(component);
        onMount(component, entry, fetcher, policy);
    });
    component.addUnmountListener(() => { /* nothing — server has no gc, focus, or interval */ });
    const dummy = createEntry<T>();
    return attachHandle(component, dummy.data, dummy.error, dummy.loading);
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
    private readonly _policy: FetchPolicy;

    constructor(id: string, fetcher: () => Promise<T>, options?: QueryOptions) {
        this._id = id;
        this._fetcher = fetcher;
        this._policy = makeFetchPolicy(options);
        this._entry = createEntry<T>();
        this.data = this._entry.data;
        this.error = this._entry.error;
        this.loading = this._entry.loading;
        if (queryRegistry.has(id)) console.warn(`[Query] Duplicate ID "${id}" — the previous instance will lose SSR hydration.`);
        queryRegistry.set(id, this._entry as QueryCacheEntry<unknown>);
        // Apply any pending hydration that arrived before this constructor ran
        const hydration = pendingHydration?.[id];
        if (hydration) { applyHydration(this._entry, hydration); delete pendingHydration![id]; }
    }

    bind(): QueryHandle<T> {
        const id = this._id;
        return bindConcreteEntry(
            () => this._entry,
            c => (onQueryBind!(c, id) as QueryCacheEntry<T>) ?? this._entry,
            this._fetcher,
            this._policy,
            () => resetEntry(this._entry),
        );
    }

    async refetch(): Promise<void> {
        return doFetch(this._entry, this._fetcher, this._policy.retry, this._policy.retryDelay);
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
    bind(key: Value<K>): QueryHandle<T>;
    refetch(key: K): Promise<void>;
    invalidate(key: K): void;
    clear(key: K): void;
};

export function createQueryFamily<K, T>(
    id: string,
    fetcher: (key: K) => Promise<T>,
    options?: QueryOptions<K>,
): QueryFamily<K, T> {
    const policy = makeFetchPolicy(options);
    const toCacheKey: (k: K) => string = options?.cacheKey ?? (k => JSON.stringify(k));
    const cache = new Map<string, QueryCacheEntry<T>>();

    function getOrCreateClient(ck: string): QueryCacheEntry<T> {
        let entry = cache.get(ck);
        if (!entry) {
            entry = createEntry<T>();
            cache.set(ck, entry);
            // Apply pending hydration
            const hydration = pendingHydration?.[`${id}\0${ck}`];
            if (hydration) { applyHydration(entry, hydration); delete pendingHydration![`${id}\0${ck}`]; }
        }
        return entry;
    }

    function doGC(entry: QueryCacheEntry<T>, ck: string): void {
        resetEntry(entry);
        if (cache.get(ck) === entry) cache.delete(ck);
    }

    function bindConcrete(key: K): QueryHandle<T> {
        const ck = toCacheKey(key);
        const globalKey = `${id}\0${ck}`;
        return bindConcreteEntry(
            () => getOrCreateClient(ck),
            c => onQueryBind!(c, globalKey) as QueryCacheEntry<T>,
            () => fetcher(key),
            policy,
            entry => doGC(entry, ck),
        );
    }

    function bindObservable(keyObs: Observable<K>): QueryHandle<T> {
        const currentEntrySignal = new Signal<QueryCacheEntry<T> | null>(null);
        let currentEntry: QueryCacheEntry<T> | null = null;
        let currentCk: string | null = null;
        let currentKey: K | null = null;
        let mounted = false;

        const component = new Component<null>(null, 'Query');

        const updateCb = () => component.updateRoot();
        const focusCb = policy.refetchOnFocus ? () => {
            if (currentEntry && currentKey !== null && mounted)
                runFetch(component, currentEntry, () => fetcher(currentKey!), policy);
        } : null;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        component.addMountListener(function onQueryMount() {
            mounted = true;
            if (focusCb) { ensureFocusListener(); focusRefetchCallbacks.add(focusCb); }
            if (policy.refetchInterval > 0) {
                intervalId = setInterval(() => {
                    if (!currentEntry || currentKey === null || !mounted) return;
                    if (currentEntry.fetchedAt > 0 && Date.now() - currentEntry.fetchedAt < policy.refetchInterval) return;
                    runFetch(component, currentEntry, () => fetcher(currentKey!), policy);
                }, policy.refetchInterval);
            }
        });

        component.addValueWatcher(keyObs, function onKeyChanged(key: K) {
            if (currentEntry !== null && currentCk !== null) {
                currentEntry.onFetch.delete(updateCb);
                const prev = currentEntry, prevCk = currentCk;
                onUnmount(prev, policy.gcTime, () => doGC(prev, prevCk));
            }
            const ck = toCacheKey(key);
            const globalKey = `${id}\0${ck}`;
            currentEntry = (onQueryBind?.(component, globalKey) as QueryCacheEntry<T> | null)
                ?? getOrCreateClient(ck);
            currentEntry.onFetch.add(updateCb);
            currentCk = ck;
            currentKey = key;
            currentEntrySignal.set(currentEntry);
            onMount(component, currentEntry, () => fetcher(key), policy);
        });

        component.addUnmountListener(function onQueryUnmount() {
            mounted = false;
            if (focusCb) focusRefetchCallbacks.delete(focusCb);
            if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
            if (currentEntry !== null && currentCk !== null) {
                currentEntry.onFetch.delete(updateCb);
                const entry = currentEntry, ck = currentCk;
                onUnmount(entry, policy.gcTime, () => doGC(entry, ck));
                currentEntry = null;
                currentCk = null;
                currentKey = null;
                currentEntrySignal.set(null);
            }
        });

        // Computeds read via currentEntrySignal — tracked dependency ensures re-evaluation on mount/key change
        let lastData: T | undefined = undefined;
        const data = new Computed<T | undefined>(() => {
            const cur = currentEntrySignal.get()?.data.get();
            if (cur !== undefined) lastData = cur;
            return cur ?? (policy.keepPreviousData ? lastData : undefined);
        });
        const error = new Computed<unknown>(() => currentEntrySignal.get()?.error.get());
        const loading = new Computed<boolean>(() => currentEntrySignal.get()?.loading.get() ?? false);

        return attachHandle(component, data, error, loading);
    }

    return {
        signal(key: K): Signal<T | undefined> {
            return getOrCreateClient(toCacheKey(key)).data;
        },

        bind(key: Value<K>): QueryHandle<T> {
            if (key instanceof Observable) return bindObservable(key);
            if (typeof key === 'function') return bindObservable(new Computed(key as () => K, { polled: true }));
            return bindConcrete(key as K);
        },

        refetch(key: K): Promise<void> {
            const entry = cache.get(toCacheKey(key));
            if (!entry) return Promise.resolve();
            return doFetch(entry, () => fetcher(key), policy.retry, policy.retryDelay);
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
        if (key.includes('\0')) continue; // family entry — applied lazily in getOrCreateClient
        const entry = queryRegistry.get(key);
        if (entry) { applyHydration(entry, val); delete pendingHydration[key]; }
    }
    if (Object.keys(pendingHydration).length === 0) pendingHydration = null;
}
