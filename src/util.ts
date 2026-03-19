
type IfEquals<X, Y, A, B> =
    (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? A : B;

export type WritableKeys<T> = {
    [P in keyof T]: IfEquals<{ [Q in P]: T[P] }, { -readonly [Q in P]: T[P] }, P, never>
}[keyof T];

export type WritablePart<T> = Pick<T, WritableKeys<T>>;



export function errorDescription(e: unknown): string {
    return e instanceof Error ? e.stack ?? e.message : `thrown value: ${e}`;
}


export function memoizeThunk<T>(func: () => T): () => T {
    let hasValue = false;
    let value: T;
    return () => {
        if (!hasValue) {
            value = func();
            hasValue = true;
        }
        return value;
    };
}

export function asyncDelay(timeoutMillis: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, timeoutMillis);
    });
}

export class Deferred<T> {
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;
    readonly promise = new Promise<T>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}

export class Semaphore {
    readonly maxCount: number;
    private readonly waiters: Deferred<void>[] = [];

    constructor(private count = 1) {
        this.maxCount = count;
    }

    tryAcquire(): boolean {
        if (this.count > 0) {
            --this.count;
            return true;
        }
        return false;
    }

    acquire(): Promise<void> {
        if (this.count > 0) {
            --this.count;
            return Promise.resolve();
        }
        var deferred = new Deferred<void>()
        this.waiters.push(deferred);
        return deferred.promise;
    }

    release(): void {
        if (this.count === this.maxCount) {
            throw new Error('too many calls to release()');
        }
        if (this.waiters.length > 0) {
            if (this.count !== 0) {
                throw new Error('count should be 0');
            }
            const waiter = this.waiters.shift()!;
            waiter.resolve();
        } else {
            ++this.count;
        }
    }

    async withAcquired(func: () => void | Promise<void>): Promise<void> {
        await this.acquire();
        try {
            const result = func();
            if (result instanceof Promise) {
                await result;
            }
        } finally {
            this.release();
        }
    }
}


export function isPlainObject(value: unknown): value is { [key: string]: unknown } {
    return !!value && Object.getPrototypeOf(value) === Object.prototype;
}

export function shallowEqual(a: unknown, b: unknown): boolean {
    return a === b;
}

export function deepEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a)) {
        return Array.isArray(b) && arraysEqual(a, b, deepEqual);
    }
    if (isPlainObject(a)) {
        return isPlainObject(b) && objectsEqual(a, b, deepEqual);
    }
    return a === b;
}

export function arraysEqual(a: unknown[], b: unknown[], eq?: (a: unknown, b: unknown) => boolean): boolean {
    if (a.length !== b.length) {
        return false;
    }
    eq ??= shallowEqual;
    for (let i = 0; i < a.length; ++i) {
        if (!eq(a[i], b[i])) {
            return false;
        }
    }
    return true;
}

export function objectsEqual(a: { [key: string]: unknown }, b: { [key: string]: unknown }, eq?: (a: unknown, b: unknown) => boolean): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    eq ??= shallowEqual;
    aKeys.sort();
    bKeys.sort();
    for (let i = 0; i < aKeys.length; ++i) {
        const key = aKeys[i]!;
        if (key !== bKeys[i]) {
            return false;
        }
        if (!eq(a[key], b[key])) {
            return false;
        }
    }
    return true;
}




// ThinVec avoids the array allocation for vectors of length 0 or 1
export type ThinVec<T> = undefined | T | T[];

export function tvLength<T>(vec: ThinVec<T>): number {
    if (vec === undefined) {
        return 0;
    }
    if (!Array.isArray(vec)) {
        return 1;
    }
    return vec.length;
}

export function tvPush<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (Array.isArray(value)) {
        throw new Error('cannot push array into ThinVec');
    }
    if (value === undefined) {
        throw new Error('cannot push undefined into ThinVec');
    }
    if (vec === undefined) {
        return value;
    }
    if (!Array.isArray(vec)) {
        return [vec, value];
    }
    vec.push(value);
    return vec;
}

export function tvPop<T>(vec: ThinVec<T>): ThinVec<T> {
    if (vec === undefined || !Array.isArray(vec)) {
        return undefined;
    }
    vec.pop();
    if (vec.length === 1) {
        return vec[0]!;
    }
    return vec;
}

export function tvRemove<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (vec === undefined || vec === value) {
        return undefined;
    }
    if (!Array.isArray(vec)) {
        return vec; // not found (would have hit previous case)
    }
    const i = vec.indexOf(value);
    if (i < 0) {
        return vec; // not found
    }
    switch (vec.length) {
        case 1: return undefined;
        case 2: return i === 0 ? vec[1]! : vec[0]!;
    }
    vec.splice(i, 1);
    return vec;
}

export function tvLast<T>(vec: ThinVec<T>): T | undefined {
    if (vec === undefined) {
        return undefined;
    }
    if (!Array.isArray(vec)) {
        return vec;
    }
    return vec[vec.length - 1];
}

export function tvForEach<T>(vec: ThinVec<T>, func: (value: T) => void | boolean): void {
    if (vec === undefined) {
        return;
    }
    if (!Array.isArray(vec)) {
        func(vec);
        return;
    }
    for (const value of vec) {
        if (func(value) === false) {
            break;
        }
    }
}








export function createDirtyTracker() {
    let gen = 0;
    return {
        invalidate() { gen++; },
        derived<T>(compute: () => T): () => T {
            let at = -1;
            let cached: T;
            return () => {
                if (at !== gen) {
                    cached = compute();
                    at = gen;
                }
                return cached;
            };
        }
    };
}

export function derive<S, T>(source: () => S, transform: (s: S) => T): () => T;
export function derive<S1, S2, T>(sources: [() => S1, () => S2], transform: (s1: S1, s2: S2) => T): () => T;
export function derive<S1, S2, S3, T>(sources: [() => S1, () => S2, () => S3], transform: (s1: S1, s2: S2, s3: S3) => T): () => T;
export function derive<S1, S2, S3, S4, T>(sources: [() => S1, () => S2, () => S3, () => S4], transform: (s1: S1, s2: S2, s3: S3, s4: S4) => T): () => T;
export function derive(sourceOrSources: (() => unknown) | Array<() => unknown>, transform: (...args: unknown[]) => unknown): () => unknown {
    if (typeof sourceOrSources === 'function') {
        let p0: unknown, r: unknown, init = false;
        return () => {
            const s = sourceOrSources();
            if (init && s === p0) return r;
            init = true; p0 = s;
            return (r = transform(s));
        };
    }
    const sources = sourceOrSources;
    const n = sources.length;
    let r: unknown;
    let init = false;
    if (n === 2) {
        const g0 = sources[0]!, g1 = sources[1]!;
        let p0: unknown, p1: unknown;
        return () => {
            const s0 = g0(), s1 = g1();
            if (init && s0 === p0 && s1 === p1) return r;
            init = true; p0 = s0; p1 = s1;
            return (r = transform(s0, s1));
        };
    }
    if (n === 3) {
        const g0 = sources[0]!, g1 = sources[1]!, g2 = sources[2]!;
        let p0: unknown, p1: unknown, p2: unknown;
        return () => {
            const s0 = g0(), s1 = g1(), s2 = g2();
            if (init && s0 === p0 && s1 === p1 && s2 === p2) return r;
            init = true; p0 = s0; p1 = s1; p2 = s2;
            return (r = transform(s0, s1, s2));
        };
    }
    if (n === 4) {
        const g0 = sources[0]!, g1 = sources[1]!, g2 = sources[2]!, g3 = sources[3]!;
        let p0: unknown, p1: unknown, p2: unknown, p3: unknown;
        return () => {
            const s0 = g0(), s1 = g1(), s2 = g2(), s3 = g3();
            if (init && s0 === p0 && s1 === p1 && s2 === p2 && s3 === p3) return r;
            init = true; p0 = s0; p1 = s1; p2 = s2; p3 = s3;
            return (r = transform(s0, s1, s2, s3));
        };
    }
    const prev = new Array(n);
    return () => {
        let changed = !init;
        for (let i = 0; i < n; i++) {
            const v = sources[i]!();
            if (v !== prev[i]) { changed = true; prev[i] = v; }
        }
        if (!changed) return r;
        init = true;
        return (r = transform(...prev));
    };
}

export function generateUUID() {
    let d = new Date().getTime();
    let d2 = ((typeof performance !== 'undefined') && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}
