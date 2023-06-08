
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







export function calcLevenshteinMatrix(a: unknown[], b: unknown[]): Uint16Array {
    const h = a.length + 1;
    const w = b.length + 1;
    const d = new Uint16Array(h * w);
    for (let y = 1; y < h; ++y) {
        d[y*w] = y;
    }
    for (let x = 1; x < w; ++x) {
        d[x] = x;
    }
    for (let y = 1; y < h; ++y) {
        for (let x = 1; x < w; ++x) {
            const cost = a[y-1] === b[x-1] ? 0 : 1;
            d[y*w + x] = Math.min(
                d[(y - 1)*w + x]! + 1,          // deletion
                d[y*w + x - 1]! + 1,            // insertion
                d[(y - 1)*w + x - 1]! + cost    // substitution
            );
        }
    }
    return d;
}

export function calcLevenshteinDistance(a: unknown[], b: unknown[]): number {
    const d = calcLevenshteinMatrix(a, b);
    return d[d.length - 1]!;
}

type LevenshteinOperation<T> =
    { type: 'insert', value: T, before: T | undefined } |
    { type: 'remove', value: T } |
    { type: 'replace', oldValue: T, newValue: T };

export function calcLevenshteinOperations<T>(a: T[], b: T[]): LevenshteinOperation<T>[] {
    const d = calcLevenshteinMatrix(a, b);
    const h = a.length + 1;
    const w = b.length + 1;
    let y = h - 1;
    let x = w - 1;
    const operations: LevenshteinOperation<T>[] = [];
    for (;;) {
        const curr = d[y*w + x]!;
        if (curr === 0) {
            break;
        }
        const diag = y > 0 && x > 0 ? d[(y - 1)*w + x - 1]! : 200000000;
        const up = y > 0 ? d[(y - 1)*w + x]! : 100000000;
        const left = x > 0 ? d[y*w + x - 1]! : 100000000;
        if (diag <= up && diag <= left && (diag === curr || diag === curr - 1)) {
            if (diag === curr - 1) {
                operations.push({ type: 'replace', oldValue: a[y - 1]!, newValue: b[x - 1]! });
            }
            --y;
            --x;
        } else if (left <= up && (left === curr || left === curr - 1)) {
            operations.push({ type: 'insert', value: b[x - 1]!, before: x === w ? undefined : b[x]! ?? null });
            --x;
        } else {
            operations.push({ type: 'remove', value: a[y - 1]! });
            --y;
        }
    }
    return operations;
}

function printLevenshteinMatrix(a: string[], b: string[]): void {
    const d = calcLevenshteinMatrix(a, b);
    const h = a.length + 1;
    const w = b.length + 1;
    const log: string[] = ['    '];
    for (let x = 0; x < w-1; ++x) {
        log.push(b[x]!);
        log.push(' ');
    }
    log.push('\n');
    for (let y = 0; y < h; ++y) {
        log.push(y === 0 ? ' ' : a[y - 1]!);
        log.push(' ');
        for (let x = 0; x < w; ++x) {
            log.push(d[y*w + x]!.toString());
            log.push(' ');
        }
        log.push('\n');
    }
    console.log(log.join(''));
}

function runLevenshteinTests() {
    verifyExample('f', '', 1);
    verifyExample('', 'f', 1);
    verifyExample('', '', 0);
    verifyExample('democrat', 'republican', 8);
    verifyExample('foo', 'foo',  0);
    verifyExample('oo', 'foo', 1);
    verifyExample('foo', 'doo', 1);
    verifyExample('foo', 'fao', 1);
    verifyExample('foo', 'fo', 1);
    verifyExample('fo', 'foo', 1);
    verifyExample('foo', 'faoo', 1);
    verifyExample('abcdefgh', 'bCdDefh', 4);
    verifyExample('abcdef', 'abc', 3);


    function verifyExample(from: string, to: string, expectedDistance: number): void {
        //printLevenshteinMatrix(_(from), _(to));
        const operations = calcLevenshteinOperations(_(from), _(to));
        console.assert(operations.length === expectedDistance);
        let transformed = from;
        for (const op of operations) {
            switch (op.type) {
            case 'replace':
                transformed = transformed.replace(op.oldValue, op.newValue);
                break;
            case 'insert':
                const i = op.before ? transformed.indexOf(op.before) : transformed.length;
                transformed = [transformed.slice(0, i), op.value, transformed.slice(i)].join('');
                break;
            case 'remove':
                transformed = transformed.replace(op.value, '');
                break;
            }
            //console.log(transformed);
        }
        console.assert(calcLevenshteinDistance(_(from), _(to)) === expectedDistance);
        console.assert(transformed === to, transformed, '===', to);
    }

    function _(s: string): string[] {
        return s.split('');
    }
}

runLevenshteinTests();


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
        return (c == 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}
