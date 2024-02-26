const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

let context: Calculated<any> | undefined;

let currentBatch: Effect[] | undefined;

export function batchEffects<T>(func: () => T): T {
    const isBatchOwnedHere = !currentBatch;
    if (!currentBatch) {
        currentBatch = [];
    }
    try {
        const result = func();
        if (isBatchOwnedHere) {
            for (const entry of currentBatch) {
                entry.get();
            }
        }
        return result;
    } finally {
        if (isBatchOwnedHere) {
            currentBatch = undefined;
        }
    }
}

export function noEffects<T>(func: () => T): T {
    const previousBatch = currentBatch;
    currentBatch = []; // we will just discard these
    try {
        return func();
    } finally {
        currentBatch = previousBatch;
    }
}

export abstract class Observable<T> {
    abstract requiresPolling(): boolean;
    abstract get(): T;

    private dependents?: Calculated<unknown>[];

    protected invalidateDependents(): void {
        if (this.dependents?.length) {
            const entries = this.dependents;
            this.dependents = undefined;
            batchEffects(() => {
                for (const entry of entries) {
                    entry.invalidate();
                }
            });
        }
    }

    protected addContextAsDependent(): void {
        if (context) {
            context.incrementDependecyCount();
            this.dependents ??= [];
            if (this.dependents.indexOf(context) < 0) {
                this.dependents.push(context);
            }
        }
    }
}

export class Signal<T> extends Observable<T> {
    constructor(private value: T) {
        super();
    }

    override requiresPolling(): boolean {
        return false;
    }

    override get(): T {
        this.addContextAsDependent();
        return this.value;
    }

    set(v: T): T {
        if (v !== this.value) {
            this.value = v;
            this.invalidateDependents();
        }
        return v;
    }

    update(f: (v: T) => T): T {
        return this.value = f(this.value);
    }
}

export class Calculated<T> extends Observable<T> {
    private value: T | Nil = Nil;
    private lastValue?: T;
    private dependencyCount = 0;
    private polled = false;

    constructor(private readonly func: (lastValue?: T) => T) {
        super();
    }

    override requiresPolling(): boolean {
        return this.polled;
    }

    override get(): T {
        this.addContextAsDependent();
        if (this.value === Nil || this.polled) {
            const prevContext = context;
            context = this;
            try {
                this.dependencyCount = 0;
                this.polled = false;
                this.lastValue = this.value = this.func(this.lastValue);
                this.polled ||= this.dependencyCount === 0;
                if (this.polled && prevContext) {
                    prevContext.polled = true;
                }
            } finally {
                context = prevContext;
            }
        }
        return this.value;
    }

    invalidate(): void {
        if (this.value !== Nil) {
            this.value = Nil;
            this.invalidateDependents();
        }
    }

    incrementDependecyCount(): void {
        ++this.dependencyCount;
    }
}

export class Effect extends Calculated<void> {
    constructor(func: () => void, private isActive = true) {
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

    protected override addContextAsDependent(): void {}

    protected override invalidateDependents(): void {
        if (this.isActive && currentBatch && currentBatch.indexOf(this) < 0) {
            // push ourself into the current batch, so we are recaculated at the end of it
            currentBatch.push(this);
        }
    }
}


export function TestObservable() {
    const a = new Signal(2);
    const b = new Signal(3);
    const sum = new Calculated(() => a.get() + b.get());

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


