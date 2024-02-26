const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

let context: Calculated<unknown> | undefined;

let currentBatch: Sink<unknown>[] | undefined;

function batch(func: () => void): void {
    const shouldRunBatch = !currentBatch;
    if (!currentBatch) {
        currentBatch = [];
    }
    try {
        func();
        if (shouldRunBatch) {
            for (const entry of currentBatch) {
                entry.get();
            }
        }
    } finally {
        if (shouldRunBatch) {
            currentBatch = undefined;
        }
    }
}

abstract class Observable<T> {
    abstract get(): T;

    private dependents?: Calculated<unknown>[];

    protected invalidateDependents(): void {
        if (this.dependents?.length) {
            const entries = this.dependents;
            this.dependents = undefined;
            batch(() => {
                for (const entry of entries) {
                    entry.invalidate();
                }
            });
        }
    }

    protected addContextAsDependent(): void {
        if (context) {
            this.dependents ??= [];
            if (this.dependents.indexOf(context) < 0) {
                this.dependents.push(context);
            }
        }
    }
}

class Signal<T> extends Observable<T> {
    constructor(private value: T) {
        super();
    }

    override get(): T {
        this.addContextAsDependent();
        return this.value;
    }

    set(v: T): void {
        if (context) {
            throw new Error('signal modified in derived calculation');
        }
        if (v !== this.value) {
            this.value = v;
            this.invalidateDependents();
        }
    }

    update(f: (v: T) => T): void {
        this.set(f(this.value));
    }
}

class Calculated<T> extends Observable<T> {
    private value: T | Nil = Nil;

    constructor(private readonly func: () => T) {
        super();
    }

    override get(): T {
        this.addContextAsDependent();
        if (this.value != Nil) {
            return this.value;
        }

        const prevContext = context;
        context = this;
        try {
            this.value = this.func();
        } finally {
            context = prevContext;
        }
        return this.value;
    }

    invalidate(): void {
        if (this.value !== Nil) {
            this.value = Nil;
            this.invalidateDependents();
        }
    }
}

class Sink<T = void> extends Calculated<T> {
    constructor(func: () => T, private active = true) {
        super(func);
        if (active) {
            this.get();
        }
    }

    activate(): void {
        this.active = true;
        this.get();
    }

    deactivate(): void {
        this.active = false;
    }

    protected override addContextAsDependent(): void {}

    protected override invalidateDependents(): void {
        if (this.active && currentBatch && currentBatch.indexOf(this) < 0) {
            // push ourself into the current batch, so we are recaculated at the end of it
            currentBatch.push(this);
        }
    }
}


export function TestObservable() {
    const a = new Signal(2);
    const b = new Signal(3);
    const sum = new Calculated(() => a.get() + b.get());

    const sink = new Sink(() => {
        console.log('sum', sum.get());
    });

    batch(() => {
        a.set(20);
        b.set(30);
    });
    a.set(21);
    sink.deactivate();
    a.set(22);
}


