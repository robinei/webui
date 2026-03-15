const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

const defaultEquals = (a: unknown, b: unknown) => a === b;

let currentContext: Observable<unknown> | undefined;

let currentBatch: Set<Effect> | undefined;

let suppressEffectsDepth = 0;


export function batchEffects<T>(func: () => T): T {
    if (currentBatch) {
        return func(); // already an active batch
    }
    currentBatch = new Set<Effect>();
    try {
        const result = func();
        let passes = 0;
        while (currentBatch!.size > 0) {
            if (++passes > 100) throw new Error('batchEffects: effects did not stabilize after 100 passes (likely an infinite loop)');
            const batch = currentBatch!;
            currentBatch = new Set<Effect>();
            for (const entry of batch) {
                Computed.prototype.get.call(entry);
            }
        }
        return result;
    } finally {
        currentBatch = undefined;
    }
}


export function suppressEffects<T>(func: () => T): T {
    suppressEffectsDepth++;
    try {
        return func();
    } finally {
        suppressEffectsDepth--;
    }
}


export function suppressTracking<T>(func: () => T): T {
    const previousContext = currentContext;
    currentContext = undefined;
    try {
        return func();
    } finally {
        currentContext = previousContext;
    }
}


export interface ObservableOptions {
    activated?(): void;
    deactivated?(): void;
}

export abstract class Observable<T> {
    private dependents: Observable<unknown>[] | undefined = undefined;
    protected version = 0;

    hasChanged(storedVersion: number): boolean {
        this.get();
        return this.version !== storedVersion;
    }

    abstract get(): T;

    requiresPolling(): boolean { return false; }

    protected constructor(protected readonly observableOptions: ObservableOptions | undefined) { }

    protected invalidate(): void {
        const dependents = this.dependents;
        if (!dependents?.length) return;
        if (currentBatch) {
            for (const entry of dependents) entry.invalidate();
        } else {
            batchEffects(function invalidateDependents() {
                for (const entry of dependents) entry.invalidate();
            });
        }
    }

    protected addContextAsDependent(): void {
        if (currentContext) {
            currentContext.addDependency(this, this.version);
            if (!this.dependents) {
                this.dependents = [currentContext];
                this.observableOptions?.activated?.();
            } else if (!this.dependents.includes(currentContext)) {
                this.dependents.push(currentContext);
            }
        }
    }

    protected removeDependent(dependent: Observable<unknown>): void {
        const deps = this.dependents;
        if (!deps) return;
        const i = deps.indexOf(dependent);
        if (i < 0) return;
        deps[i] = deps[deps.length - 1]!;
        deps.length--;
        if (deps.length === 0) {
            this.dependents = undefined;
            this.removeFromDependencies();
            this.observableOptions?.deactivated?.();
        }
    }

    protected removeFromDependencies(): void {
        this.invalidate();
        const dependencies = this.getDependencies();
        if (dependencies) {
            for (const dependency of dependencies) {
                dependency.removeDependent(this);
            }
        }
    }

    protected unlinkDependency(dep: Observable<unknown>): void {
        dep.removeDependent(this);
    }

    protected addDependency(observable: Observable<unknown>, version: number): void { }

    protected getDependencies(): Observable<unknown>[] | undefined {
        return undefined;
    }
}


export class Constant<T> extends Observable<T> {
    constructor(private readonly value: T, options?: ObservableOptions) {
        super(options);
    }

    override get(): T {
        this.addContextAsDependent();
        return this.value;
    }
}


export interface SignalOptions<T> extends ObservableOptions {
    readonly equals?: false | ((a: T, b: T) => boolean);
}

export class Signal<T> extends Observable<T> {
    private readonly equalsFunc: (a: T, b: T) => boolean = undefined!;

    constructor(private value: T, options?: SignalOptions<T>) {
        super(options);
        this.equalsFunc = options?.equals === false ? () => false : options?.equals ?? ((a, b) => a === b);
    }

    override get(): T {
        this.addContextAsDependent();
        return this.value;
    }

    set(v: T): T {
        if (!this.equalsFunc(this.value, v)) {
            this.value = v;
            this.version++;
            this.invalidate();
        }
        return v;
    }

    modify(f: (v: T) => T): T {
        return this.set(f(this.value));
    }
}


export class DelegatedSignal<T> extends Signal<T> {
    constructor(private readonly observable: Observable<T>, private readonly modifyFunc: (f: (v: T) => T) => T) {
        super(undefined as any);
    }

    override get(): T {
        return this.observable.get();
    }

    override set(v: T): T {
        return this.modifyFunc(_ => v);
    }

    override modify(f: (v: T) => T): T {
        return this.modifyFunc(f);
    }
}



export interface ComputedOptions extends ObservableOptions {
    readonly polled?: boolean;
    readonly equals?: false | ((prev: unknown, next: unknown) => boolean);
}

export class Computed<T> extends Observable<T> {
    private readonly depKeys: Observable<unknown>[] = [];
    private readonly depVersions: number[] = [];
    private isPolled = false;
    private value: T | Nil = Nil;
    private lastValue: T | Nil = Nil;

    constructor(private readonly func: (lastValue?: T) => T, private readonly options?: ComputedOptions) {
        super(options);
        this.isPolled = !!options?.polled;
    }

    protected override addDependency(observable: Observable<unknown>, version: number): void {
        if (observable.requiresPolling()) {
            this.isPolled = true; // if we depend on a polled observable, we must ourselves require polling
        }
        const i = this.depKeys.indexOf(observable);
        if (i >= 0) {
            this.depVersions[i] = version;
        } else {
            this.depKeys.push(observable);
            this.depVersions.push(version);
        }
    }

    protected override getDependencies(): Observable<unknown>[] | undefined {
        return this.depKeys;
    }

    private areDependenciesChanged(): boolean {
        for (let i = 0; i < this.depKeys.length; i++) {
            if (this.depKeys[i]!.hasChanged(this.depVersions[i]!)) return true;
        }
        return false;
    }

    override get(): T {
        if (this.value === Nil || this.isPolled) {
            const previousContext = currentContext;
            currentContext = this;
            try {
                if (this.lastValue !== Nil && !this.isPolled && !this.areDependenciesChanged()) {
                    this.value = this.lastValue;
                } else {
                    for (let i = 0; i < this.depVersions.length; i++) {
                        this.depVersions[i] = -1;
                    }
                    this.isPolled = !!this.options?.polled;
                    const newValue = this.func(this.lastValue === Nil ? undefined : this.lastValue);
                    const equalsOpt = this.options?.equals;
                    if (this.lastValue === Nil || equalsOpt === false || !(equalsOpt ?? defaultEquals)(this.lastValue, newValue)) {
                        this.version++;
                    }
                    this.lastValue = this.value = newValue;
                    this.isPolled ||= this.depKeys.length === 0; // assume a 0-dependency Computed needs to be polled (it can't be invalidated)
                    let w = 0;
                    for (let r = 0; r < this.depKeys.length; r++) {
                        if (this.depVersions[r] !== -1) {
                            this.depKeys[w] = this.depKeys[r]!;
                            this.depVersions[w] = this.depVersions[r]!;
                            w++;
                        } else {
                            this.unlinkDependency(this.depKeys[r]!);
                        }
                    }
                    this.depKeys.length = w;
                    this.depVersions.length = w;
                }
            } finally {
                currentContext = previousContext;
            }
        }
        this.addContextAsDependent();
        return this.value;
    }

    override requiresPolling(): boolean {
        return this.isPolled;
    }

    protected override invalidate(): void {
        if (this.value !== Nil) {
            this.value = Nil;
            super.invalidate(); // invalidate dependents
        }
    }
}


export interface EffectOptions extends ComputedOptions {
    active?: boolean;
}

export class Effect extends Computed<void> {
    private active = false;

    constructor(func: () => void, options?: EffectOptions) {
        super(func, options);
        if (options?.active !== false) {
            this.activate();
        }
    }

    isActive(): boolean {
        return this.active;
    }

    activate(): void {
        if (!this.active) {
            this.active = true;
            super.get();
            this.observableOptions?.activated?.();
        }
    }

    deactivate(): void {
        if (this.active) {
            this.active = false;
            this.removeFromDependencies();
            this.observableOptions?.deactivated?.();
        }
    }

    override get(): never {
        throw new Error('Effect.get() should not be called directly');
    }

    protected override invalidate(): void {
        if (this.active && suppressEffectsDepth === 0) {
            currentBatch?.add(this);
        }
        super.invalidate();
    }

    protected override addContextAsDependent(): void { }

    protected override removeDependent(dependent: Observable<unknown>): void { }
}


const observableProxySymbol = Symbol("isObservableProxy")
const signalProxySymbol = Symbol("isSignalProxy")

export type ObservableProxy<T> = (T extends object ? Observable<T> & {
    readonly [K in keyof T as K extends string | number ? (T[K] extends Function ? never : K) : never]-?: ObservableProxy<T[K]>;
} : Observable<T>) & { _proxyBrand: string };

export function observableProxy<T extends object>(object: Observable<T>): ObservableProxy<T> {
    if ((object as any)[observableProxySymbol]) return object as unknown as ObservableProxy<T>;
    const cache: { [key: string]: unknown } = {
        get: object.get.bind(object),
        requiresPolling: object.requiresPolling.bind(object),
        hasChanged: object.hasChanged.bind(object),
    };
    return new Proxy(object, {
        get(_, key) {
            if (typeof key === 'symbol') {
                if (key === observableProxySymbol) return true;
                return undefined;
            }
            return cache[key] ??= observableProxy(new Computed(function getProxyChild() {
                return (object.get() as any)[key];
            }));
        }
    }) as ObservableProxy<T>;
}


export type SignalProxy<T> = (T extends object ? Signal<T> & {
    readonly [K in keyof T as K extends string | number ? (T[K] extends Function ? never : K) : never]-?: SignalProxy<T[K]>;
} : Signal<T>) & { _proxyBrand: string };

export function signalProxy<T extends object>(object: Signal<T>): SignalProxy<T> {
    if ((object as any)[signalProxySymbol]) return object as unknown as SignalProxy<T>;
    const cache: { [key: string]: unknown } = {
        get: object.get.bind(object),
        requiresPolling: object.requiresPolling.bind(object),
        hasChanged: object.hasChanged.bind(object),
        set: object.set.bind(object),
        modify: object.modify.bind(object),
    };
    return new Proxy(object, {
        get(_, key) {
            if (typeof key === 'symbol') {
                if (key === observableProxySymbol) return true;
                if (key === signalProxySymbol) return true;
                return undefined;
            }
            return cache[key] ??= signalProxy(new DelegatedSignal(
                new Computed(function getProxyChild() {
                    return (object.get() as any)[key];
                }),
                function modifyProxyChild(f) {
                    return object.modify(function modifyProxy(obj: any) {
                        return setValueForKey(obj, key, f(obj[key]));
                    });
                }
            ));
        },
    }) as SignalProxy<T>;
}

function setValueForKey<T extends object>(obj: T, key: string, value: unknown): T {
    if (Array.isArray(obj)) {
        const index = Number(key);
        if (!Number.isInteger(index)) {
            throw new Error(`expected integer key when modifying array, but got: ${key}`);
        }
        return obj.map((elem, i) => i === index ? value : elem) as T;
    }
    if (!obj || Object.getPrototypeOf(obj) !== Object.prototype) {
        throw new Error('can only proxy modifications of plain objects');
    }
    return { ...obj, [key]: value };
}


export function isObservableProxy<T>(value: T | (() => T) | Observable<T> | ObservableProxy<T>): value is ObservableProxy<T> {
    return value && typeof value === 'object' && (value as any)[observableProxySymbol] === true;
}


export function createComputedFamily<K, T>(
    factory: (key: K) => (lastValue?: T) => T,
    options?: ComputedOptions & { cacheKey?: (k: K) => string },
): (key: K) => Computed<T> {
    const toCacheKey: (k: K) => string = options?.cacheKey ?? (k => JSON.stringify(k));
    const { cacheKey: _, ...computedOptions } = options ?? {};
    const cache = new Map<string, Computed<T>>();

    return function getOrCreateComputed(key: K): Computed<T> {
        const ck = toCacheKey(key);
        let c = cache.get(ck);
        if (!c) {
            c = new Computed(factory(key), {
                ...computedOptions,
                deactivated() {
                    cache.delete(ck);
                    computedOptions.deactivated?.call(c!);
                },
            });
            cache.set(ck, c);
        }
        return c;
    };
}
