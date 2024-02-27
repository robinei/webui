const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

let context: Observable<unknown> | undefined;

let currentBatch: Observable<unknown>[] | undefined;

export function batchEffects<T>(func: () => T): T {
    if (currentBatch) {
        return func(); // already an active batch
    }
    currentBatch = [];
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
    currentBatch = []; // we will just discard these
    try {
        return func();
    } finally {
        currentBatch = previousBatch;
    }
}

export abstract class Observable<T> {
    private dependents?: Observable<unknown>[];

    abstract get(): T;

    requiresPolling(): boolean { return false; }

    protected invalidate(): void {
        if (this.dependents?.length) {
            const entries = this.dependents;
            this.dependents = undefined;
            batchEffects(() => {
                for (let entry of entries) {
                    entry.invalidate();
                }
            });
        }
    }

    protected addContextAsDependent(lastValue: T): void {
        if (context) {
            context.addDependency(this, lastValue);
            this.dependents ??= [];
            if (this.dependents.indexOf(context) < 0) {
                this.dependents.push(context);
            }
        }
    }

    protected addDependency(observable: Observable<unknown>, lastValue: unknown): void {}
}

export class Signal<T> extends Observable<T> {
    constructor(private value: T, private readonly options?: {
        readonly equals?: false | ((prev: T, next: T) => boolean)
    }) {
        super();
    }

    override get(): T {
        this.addContextAsDependent(this.value);
        return this.value;
    }

    set(v: T): T {
        if (this.options?.equals == false || (this.options?.equals ? !this.options.equals(this.value, v) : this.value !== v)) {
            this.value = v;
            this.invalidate();
        }
        return v;
    }

    modify(f: (v: T) => T): T {
        return this.set(f(this.value));
    }
}

interface Dependecy {
    lastValue: unknown;
    observable: Observable<unknown>;
}

export class Computed<T> extends Observable<T> {
    private value: T | Nil = Nil;
    private lastValue?: T;
    private dependencies: Dependecy[] = [];
    private polled: boolean;

    constructor(private readonly func: (lastValue?: T) => T, private readonly options?: {
        readonly polled?: boolean,
        readonly equals?: false | ((prev: unknown, next: unknown) => boolean)
    }) {
        super();
        this.polled = !!options?.polled;
    }

    protected override addDependency(observable: Observable<unknown>, lastValue: unknown): void {
        if (observable.requiresPolling()) {
            this.polled = true; // if we depend on a polled observable, we must ourselves require polling
        }
        for (const entry of this.dependencies) {
            if (entry.observable === observable) {
                return; // already added
            }
        }
        this.dependencies.push({ lastValue, observable });
    }

    private shouldRecompute(): boolean {
        if (this.polled || this.options?.equals == false) {
            return true;
        }
        const equals = this.options?.equals ?? ((prev, next) => prev === next);
        for (const entry of this.dependencies) {
            if (!equals(entry.lastValue, entry.observable.get())) {
                return true;
            }
        }
        return false;
    }

    override get(): T {
        if (this.value === Nil || this.shouldRecompute()) {
            const previousContext = context;
            context = this;
            try {
                this.dependencies = [];
                this.polled = !!this.options?.polled;
                this.lastValue = this.value = this.func(this.lastValue);
                this.polled ||= this.dependencies.length === 0; // assume a 0-dependency Computed needs to be polled (it can't be invalidated)
            } finally {
                context = previousContext;
            }
        }
        this.addContextAsDependent(this.value);
        return this.value;
    }

    override requiresPolling(): boolean {
        return this.polled;
    }

    protected override invalidate(): void {
        if (this.value !== Nil) {
            this.value = Nil;
            super.invalidate(); // invalidate dependents
        }
    }
}

export class Effect<T> extends Computed<T> {
    constructor(func: (lastValue?: T) => T, private isActive = true) {
        super(func);
        if (isActive) {
            this.get(); 
        }
    }

    activate(): void {
        if (!this.isActive) {
            this.isActive = true;
            this.get();
        }
    }

    deactivate(): void {
        this.isActive = false;
    }

    protected override invalidate(): void {
        super.invalidate();
        if (this.isActive && currentBatch && currentBatch.indexOf(this) < 0) {
            currentBatch.push(this); // push ourself into the current batch, so we are re-computed at the end of it
        }
    }
}


export function TestObservable() {
    const a = new Signal(2);
    const b = new Signal(3);
    const sum = new Computed(() => {
        console.log('recompute');
        return a.get() + b.get();
    });

    const effect = new Effect(() => {
        console.log('sum', sum.get());
    });

    batchEffects(() => {
        a.set(10000);
        a.set(20);
        b.set(30);
    });
    a.set(21);
    effect.deactivate();
    a.set(22);
}


