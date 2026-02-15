
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

function runDeepEqualTests() {
    console.assert(deepEqual(1, 1));
    console.assert(!deepEqual(1, 2));
    console.assert(deepEqual('a', 'a'));
    console.assert(!deepEqual('a', 'b'));
    console.assert(!deepEqual('a', 1));
    console.assert(deepEqual([1], [1]));
    console.assert(!deepEqual([1], [2]));
    console.assert(!deepEqual([1], [1,2]));
    console.assert(deepEqual({a: 1}, {a: 1}));
    console.assert(!deepEqual({a: 1}, {a: 2}));
    console.assert(deepEqual({a: [1]}, {a: [1]}));
    console.assert(!deepEqual({a: [1]}, {a: [2]}));
    console.assert(!deepEqual({a: [1]}, {b: [1]}));
    console.assert(!deepEqual({a: [1]}, {a: [1], b: 2}));
    console.assert(!deepEqual({a: [1], b: 2}, {a: [1]}));
    console.assert(deepEqual({a: [1], b: 2}, {a: [1], b: 2}));
}
runDeepEqualTests();




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

function tvRunTests() {
    let vec: ThinVec<number>;

    vec = tvPush(vec, 0);
    vec = tvPush(vec, 1);
    vec = tvPush(vec, 2);
    console.assert(tvLength(vec) === 3);
    console.assert(tvLast(vec) === 2);
    vec = tvRemove(vec, 2);
    console.assert(tvLength(vec) === 2);
    console.assert(tvLast(vec) === 1);
    vec = tvRemove(vec, 1);
    console.assert(tvLength(vec) === 1);
    console.assert(tvLast(vec) === 0);
    vec = tvRemove(vec, 0);
    console.assert(tvLength(vec) === 0);
    console.assert(tvLast(vec) === undefined);
    
    vec = tvPush(vec, 0);
    vec = tvPush(vec, 1);
    vec = tvPush(vec, 2);
    console.assert(tvLength(vec) === 3);
    console.assert(tvLast(vec) === 2);
    vec = tvPop(vec);
    console.assert(tvLength(vec) === 2);
    console.assert(tvLast(vec) === 1);
    vec = tvPop(vec);
    console.assert(tvLength(vec) === 1);
    console.assert(tvLast(vec) === 0);
    vec = tvPop(vec);
    console.assert(tvLength(vec) === 0);
    console.assert(tvLast(vec) === undefined);
}

tvRunTests();







/**
 * Returns indices into `arr` that form the longest strictly increasing subsequence.
 * O(n log n) time, O(n) space.
 */
export function longestIncreasingSubsequence(arr: number[]): number[] {
    const n = arr.length;
    if (n === 0) return [];

    // tails[i] = index in arr of the smallest tail of all increasing subsequences of length i+1
    const tails: number[] = [];
    // prev[i] = index in arr of the predecessor of arr[i] in the best subsequence ending at i
    const prev = new Int32Array(n).fill(-1);

    for (let i = 0; i < n; i++) {
        const val = arr[i]!;
        // Binary search: find leftmost position in tails where arr[tails[pos]] >= val
        let lo = 0, hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[tails[mid]!]! < val) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if (lo > 0) {
            prev[i] = tails[lo - 1]!;
        }
        tails[lo] = i;
    }

    // Reconstruct
    const result = new Array<number>(tails.length);
    let idx = tails[tails.length - 1]!;
    for (let i = tails.length - 1; i >= 0; i--) {
        result[i] = idx;
        idx = prev[idx]!;
    }
    return result;
}

function runLISTests() {
    // Empty
    console.assert(arraysEqual(longestIncreasingSubsequence([]), []));
    // Single element
    console.assert(arraysEqual(longestIncreasingSubsequence([5]), [0]));
    // Already sorted
    console.assert(arraysEqual(longestIncreasingSubsequence([1, 2, 3, 4]), [0, 1, 2, 3]));
    // Reversed — LIS length 1
    console.assert(longestIncreasingSubsequence([4, 3, 2, 1]).length === 1);
    // Mixed — [1, 3, 4] is the LIS (indices 0, 1, 2)
    const lis1 = longestIncreasingSubsequence([1, 3, 4, 0, 2]);
    console.assert(lis1.length === 3);
    console.assert(lis1[0]! < lis1[1]! && lis1[1]! < lis1[2]!); // indices are increasing
    for (let i = 1; i < lis1.length; i++) {
        console.assert([1, 3, 4, 0, 2][lis1[i]!]! > [1, 3, 4, 0, 2][lis1[i - 1]!]!); // values are increasing
    }
    // [3, 1, 4, 1, 5, 9, 2, 6] — LIS length 4 (e.g. 3,4,5,9 or 1,4,5,6)
    console.assert(longestIncreasingSubsequence([3, 1, 4, 1, 5, 9, 2, 6]).length === 4);
    // Duplicates — strictly increasing, so duplicates don't extend
    console.assert(longestIncreasingSubsequence([2, 2, 2, 2]).length === 1);
    // Two interleaved sequences
    console.assert(longestIncreasingSubsequence([0, 8, 1, 9, 2, 10, 3]).length === 4); // 0,1,2,3
}

runLISTests();


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
