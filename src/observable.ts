const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

let currentContext: Observable<unknown> | undefined;

let currentBatch: Set<Observable<unknown>> | undefined;


export function batchEffects<T>(func: () => T): T {
    if (currentBatch) {
        return func(); // already an active batch
    }
    currentBatch = new Set<Observable<unknown>>();
    try {
        const result = func();
        for (const entry of currentBatch) {
            entry.get(); // trigger recomputation of entire batch
        }
        return result;
    } finally {
        currentBatch = undefined;
    }
}


export function suppressEffects<T>(func: () => T): T {
    const previousBatch = currentBatch;
    currentBatch = undefined;
    try {
        return func();
    } finally {
        currentBatch = previousBatch;
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
    private dependents?: Set<Observable<unknown>>;

    abstract get(): T;

    requiresPolling(): boolean { return false; }

    protected constructor(protected readonly observableOptions: ObservableOptions | undefined) {}

    protected invalidate(): void {
        const dependents = this.dependents;
        if (dependents?.size) {
            batchEffects(function invalidateDependents() {
                for (let entry of dependents) {
                    entry.invalidate();
                }
            });
        }
    }

    protected addContextAsDependent(lastValue: T): void {
        if (currentContext) {
            currentContext.addDependency(this, lastValue);
            const sizeBefore = this.dependents?.size;
            (this.dependents ??= new Set()).add(currentContext);
            if (!sizeBefore) {
                this.observableOptions?.activated?.();
            }
        }
    }

    protected removeDependent(dependent: Observable<unknown>): void {
        if (this.dependents?.delete(dependent) && this.dependents.size === 0) {
            this.removeFromDependencies();
            this.observableOptions?.deactivated?.();
        }
    }

    protected removeFromDependencies(): void {
        this.invalidate();
        const dependencies = this.getDependencies();
        if (dependencies) {
            for (const [dependency, _] of dependencies) {
                dependency.removeDependent(this);
            }
        }
    }

    protected addDependency(observable: Observable<unknown>, lastValue: unknown): void {}

    protected getDependencies(): Map<Observable<unknown>, unknown> | undefined {
        return undefined;
    }
}


export class Constant<T> extends Observable<T> {
    constructor(private readonly value: T, options?: ObservableOptions) {
        super(options);
    }

    override get(): T {
        this.addContextAsDependent(this.value);
        return this.value;
    }
}


export interface SignalOptions<T> extends ObservableOptions {
    readonly equals?: false | ((a: T, b: T) => boolean);
}

export class Signal<T> extends Observable<T> {
    private readonly equalsFunc: (a: T, b: T) => boolean;

    constructor(private value: T, options?: SignalOptions<T>) {
        super(options);
        this.equalsFunc = options?.equals === false ? () => false : options?.equals ?? ((a, b) => a === b)
    }

    override get(): T {
        this.addContextAsDependent(this.value);
        return this.value;
    }

    set(v: T): T {
        if (!this.equalsFunc(this.value, v)) {
            this.value = v;
            this.invalidate();
        }
        return v;
    }

    modify(f: (v: T) => T): T {
        return this.set(f(this.value));
    }
}


class DelegatedSignal<T> extends Signal<T> {
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
    private readonly dependencies = new Map<Observable<unknown>, unknown>();
    private isPolled: boolean;
    private value: T | Nil = Nil;
    private lastValue: T | Nil = Nil;

    constructor(private readonly func: (lastValue?: T) => T, private readonly options?: ComputedOptions) {
        super(options);
        this.isPolled = !!options?.polled;
    }

    protected override addDependency(observable: Observable<unknown>, lastValue: unknown): void {
        if (observable.requiresPolling()) {
            this.isPolled = true; // if we depend on a polled observable, we must ourselves require polling
        }
        this.dependencies.set(observable, lastValue);
    }

    protected override getDependencies(): Map<Observable<unknown>, unknown> | undefined {
        return this.dependencies;
    }

    private areDependenciesChanged(): boolean {
        if (this.options?.equals === false) {
            return true;
        }
        const equals = this.options?.equals ?? ((a, b) => a === b);
        for (const [observable, lastValue] of this.dependencies) {
            const currValue = observable.get();
            if (!equals(lastValue, currValue)) {
                return true;
            }
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
                    this.dependencies.clear();
                    this.isPolled = !!this.options?.polled;
                    this.lastValue = this.value = this.func(this.lastValue === Nil ? undefined : this.lastValue);
                    this.isPolled ||= this.dependencies.size === 0; // assume a 0-dependency Computed needs to be polled (it can't be invalidated)
                }
            } finally {
                currentContext = previousContext;
            }
        }
        this.addContextAsDependent(this.value);
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

export class Effect<T> extends Computed<T> {
    private active = false;

    constructor(func: (lastValue?: T) => T, options?: EffectOptions) {
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
            this.get();
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

    protected override invalidate(): void {
        if (this.active) {
            currentBatch?.add(this); // add ourself into the current batch, so we are re-computed at the end of it
        }
        super.invalidate();
    }

    protected override addContextAsDependent(lastValue: T): void {}

    protected override removeDependent(dependent: Observable<unknown>): void {}
}


const observableProxySymbol = Symbol("isProxy")

export type ObservableProxy<T> = (T extends object ? Observable<T> & {
    readonly [K in keyof T as K extends string|number ? (T[K] extends Function ? never : K) : never]-?: ObservableProxy<T[K]>;
} : Observable<T>) & { _proxyBrand: string };

export function observableProxy<T extends object>(object: Observable<T>): ObservableProxy<T> {
    const cache: { [key: string | symbol]: unknown } = {};
    return new Proxy(object, {
        get(_, key) {
            if (key === observableProxySymbol) {
                return true;
            }
            if (typeof key === 'string') {
                switch (key) {
                    case 'get': return object.get.bind(object);
                    case 'requiresPolling': return object.requiresPolling.bind(object);
                }
                return cache[key] ??= observableProxy(new Computed(function getProxyChild() {
                    return (object.get() as any)[key];
                }));
            }
            throw new Error('unexpected key: ' + String(key));
        }
    }) as ObservableProxy<T>;
}


export type SignalProxy<T> = (T extends object ? Signal<T> & {
    readonly [K in keyof T as K extends string|number ? (T[K] extends Function ? never : K) : never]-?: SignalProxy<T[K]>;
} : Signal<T>) & { _proxyBrand: string };

export function signalProxy<T extends object>(object: Signal<T>): SignalProxy<T> {
    const cache: { [key: string | symbol]: unknown } = {};
    return new Proxy(object, {
        get(_, key) {
            if (key === observableProxySymbol) {
                return true;
            }
            if (typeof key === 'string') {
                switch (key) {
                    case 'get': return object.get.bind(object);
                    case 'requiresPolling': return object.requiresPolling.bind(object);
                    case 'set': return object.set.bind(object);
                    case 'modify': return object.modify.bind(object);
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
            }
            throw new Error('unexpected key: ' + String(key));
        },
    }) as SignalProxy<T>;
}

function setValueForKey<T extends object>(obj: T, key: string, value: unknown): T {
    if (Array.isArray(obj)) {
        const index = parseInt(key);
        if (isNaN(index)) {
            throw new Error(`expected integer key when modifying array, but got: ${key}`);
        }
        return obj.map((elem, i) => i === index ? value : elem) as T;
    }
    if (!obj || !Object.getPrototypeOf(obj) === Object.prototype) {
        throw new Error('can only proxy modifications of plain objects');
    }
    return { ...obj, [key]: value };
}


export function isObservableProxy<T>(value: T | (() => T) | Observable<T> | ObservableProxy<T>): value is ObservableProxy<T> {
    return value && typeof value === 'object' && (value as any)[observableProxySymbol] === true;
}



interface Sub {
    num: number;
}
interface Test {
    normal: Sub;
    nullable: Sub | null;
    undefable: Sub | undefined;
    optional?: Sub;
    nilnum: number|null;
    undefnum: number|undefined;
    optnum?: number;
    nil: null|number;
    undef: undefined;
}
function TestObservable() {
    {
        const sig = new Signal<Test>({
            normal: { num: 1 },
            nullable: { num: 2 },
            undefable: { num: 3 },
            optional: { num: 4 },
            nilnum: 5,
            undefnum: 6,
            optnum: 7,
            nil: null,
            undef: undefined,
        });
        const obs = observableProxy(sig);
        console.assert(sig.get() === obs.get());
        console.assert(1 === obs.normal.num.get());
        console.assert(2 === obs.nullable.get()?.num);
        console.assert(3 === obs.undefable.get()?.num);
        console.assert(4 === obs.optional.get()?.num);
        console.assert(5 === obs.nilnum.get());
        console.assert(6 === obs.undefnum.get());
        console.assert(7 === obs.optnum.get());
        console.assert(null === obs.nil.get());
        console.assert(undefined === obs.undef.get());
    }

    {
        let activatedCount = 0;
        let deactivatedCount = 0;
        let computeCount = 0;
        const a = new Signal(2);
        const b = new Signal(3);
        const sum = new Computed(() => {
            ++computeCount;
            return a.get() + b.get();
        }, {
            activated() { ++activatedCount; },
            deactivated() { ++deactivatedCount; },
        });
        console.assert(0 === computeCount);
    
        let result: number|undefined;
        const effect = new Effect(() => {
            result = sum.get();
        });
        console.assert(1 === computeCount);
        console.assert(5 === result);
    
        batchEffects(() => {
            a.set(10000);
            a.set(20);
            b.set(30);
        });
        console.assert(2 === computeCount);
        console.assert(50 === result);
        a.set(21);
        console.assert(3 === computeCount);
        console.assert(51 === result);
        console.assert(1 === activatedCount);
        console.assert(0 === deactivatedCount);
        effect.deactivate();
        a.set(22);
        console.assert(3 === computeCount);
        console.assert(51 === result);
        console.assert(1 === activatedCount);
        console.assert(1 === deactivatedCount);
        effect.activate();
        console.assert(52 === result);
        console.assert(2 === activatedCount);
        console.assert(1 === deactivatedCount);
    }

    {
        let computeCount = 0;
        let result = -1;
        const testSignal = new Signal({
            foo: {
                a: 1,
            },
            bar: {
                b: 2,
            },
            c: 3,
            d: 4,
        });
        const test = observableProxy(testSignal);
        const sum2 = new Computed(() => {
            ++computeCount;
            return test.foo.a.get() + test.bar.b.get() + test.c.get();
        });
        const effect2 = new Effect(() => {
            result = sum2.get();
        });
        console.assert(6 === result);
        testSignal.modify(t => ({...t, d: 40}));
        testSignal.modify(t => ({...t, d: 50}));
        console.assert(6 === result);
        testSignal.modify(t => ({...t, c: 440}));
        console.assert(443 === result);
        testSignal.modify(t => ({...t, foo: { ...t.foo, a: 100}}));
        testSignal.modify(t => ({...t, foo: { ...t.foo, a: 100}}));
        console.assert(3 === computeCount);
        console.assert(542 === result);
        testSignal.set({
            foo: {
                a: 1,
            },
            bar: {
                b: 2,
            },
            c: 3,
            d: 4,
        });
        console.assert(4 === computeCount);
        console.assert(6 === result);
    }

    {
        const arr = signalProxy(new Signal([1]));
        arr.modify(a => [...a, 2]);
        arr[0].modify(x => x + 10);
        console.assert(arr.length.get() === 2);
        console.assert(arr[0].get() === 11);
        console.assert(arr[1].get() === 2);
    }

    {
        const mut = signalProxy(new Signal({
            foo: {
                a: 1,
            },
        }));
        console.assert(1 === mut.get().foo.a);
        mut.foo.a.modify(x => x + 1);
        console.assert(2 === mut.get().foo.a);
    }

    {
        let activatedCount = 0;
        let deactivatedCount = 0;
        const _0 = new Signal(1, {
            activated() { ++activatedCount; },
            deactivated() { ++deactivatedCount; },
        });
        const _1 = new Computed(() => _0.get() + 1);
        const _2 = new Computed(() => _1.get() + 1);
        const _3 = new Computed(() => _2.get() + 1);
        console.assert(activatedCount === 0);
        console.assert(deactivatedCount === 0);
        const eff = new Effect(() => _3.get());
        console.assert(activatedCount === 1);
        console.assert(deactivatedCount === 0);
        eff.deactivate();
        console.assert(activatedCount === 1);
        console.assert(deactivatedCount === 1);
    }

    {
        const arr = signalProxy(new Signal([1]));
        console.assert(1 === arr[0].get());
        console.assert(undefined === arr[1].get());
        arr.modify(x => [2, ...x]);
        console.assert(2 === arr[0].get());
        console.assert(1 === arr[1].get());
        //const casted: Observable<ReadonlyArray<Observable<number>>> = arr;
    }

    {
        const proxy = signalProxy(new Signal({foo: {x: 1}}));
        console.assert(proxy instanceof Observable);
        console.assert(proxy instanceof Signal);
        console.assert(proxy.foo instanceof Observable);
        console.assert(proxy.foo instanceof Signal);
        console.assert(proxy.foo.x instanceof Observable);
        console.assert(proxy.foo.x instanceof Signal);
        console.assert(proxy.foo.x instanceof DelegatedSignal);
    }

    {
        const sig = signalProxy(new Signal({x: 1}));
        const obs: ObservableProxy<{x: number}> = sig;
        console.assert(isObservableProxy(sig));
        console.assert(isObservableProxy(obs));
        console.assert(!isObservableProxy(new Signal(1)));
    }
}

TestObservable();
