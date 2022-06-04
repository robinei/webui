
type IfEquals<X, Y, A, B> =
    (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? A : B;

export type WritableKeys<T> = {
    [P in keyof T]: IfEquals<{ [Q in P]: T[P] }, { -readonly [Q in P]: T[P] }, P, never>
}[keyof T];

export type WritablePart<T> = Pick<T, WritableKeys<T>>;



export function toError(e: unknown): Error {
    return e instanceof Error ? e : new Error(`thrown value: ${e}`);
}


export function lazy<T>(func: () => T): () => T {
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


export function listsEqual(a: unknown[], b: unknown[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}




// ThinVec avoids the array allocation for vectors of length 0 or 1 (but you can't use arrays as item type!)
export type ThinVec<T> = typeof tvEmpty | T | T[];

export const tvEmpty: unique symbol = Symbol();

export function tvLength<T>(vec: ThinVec<T>): number {
    if (vec === tvEmpty) {
        return 0;
    }
    if (!Array.isArray(vec)) {
        return 1;
    }
    return vec.length;
}

export function tvPush<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (vec === tvEmpty) {
        return value;
    }
    if (!Array.isArray(vec)) {
        return [vec, value];
    }
    vec.push(value);
    return vec;
}

export function tvPop<T>(vec: ThinVec<T>): ThinVec<T> {
    if (vec === tvEmpty || !Array.isArray(vec)) {
        return tvEmpty;
    }
    vec.pop();
    if (vec.length === 1) {
        return vec[0]!;
    }
    return vec;
}

export function tvRemove<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (vec === tvEmpty || vec === value) {
        return tvEmpty;
    }
    if (!Array.isArray(vec)) {
        return vec; // not found (would have hit previous case)
    }
    const i = vec.indexOf(value);
    if (i < 0) {
        return vec; // not found
    }
    switch (vec.length) {
    case 1: return tvEmpty;
    case 2: return i === 0 ? vec[1]! : vec[0]!;
    }
    vec.splice(i, 1);
    return vec;
}

export function tvLast<T>(vec: ThinVec<T>): T | undefined {
    if (vec === tvEmpty) {
        return undefined;
    }
    if (!Array.isArray(vec)) {
        return vec;
    }
    return vec[vec.length - 1];
}

export function tvForEach<T>(vec: ThinVec<T>, func: (value: T) => void): void {
    if (vec === tvEmpty) {
        return;
    }
    if (!Array.isArray(vec)) {
        func(vec);
        return;
    }
    for (const value of vec) {
        func(value);
    }
}

function tvRunTests() {
    let vec: ThinVec<number> = tvEmpty;

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
    { type: 'insert', value: T, before: T | null } |
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
            operations.push({ type: 'insert', value: b[x - 1]!, before: x === w ? null : b[x]! ?? null });
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
