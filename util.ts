// ThinVec avoids the array allocation for vectors of length 0 or 1 (but you can't use arrays as item type!)
export type ThinVec<T> = null | T | T[];

export function tvLength<T>(vec: ThinVec<T>): number {
    if (vec === null) {
        return 0;
    }
    if (!Array.isArray(vec)) {
        return 1;
    }
    return vec.length;
}

export function tvPush<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (vec === null) {
        return value;
    }
    if (!Array.isArray(vec)) {
        return [vec, value];
    }
    vec.push(value);
    return vec;
}

export function tvPop<T>(vec: ThinVec<T>): ThinVec<T> {
    if (vec === null || !Array.isArray(vec)) {
        return null;
    }
    vec.pop();
    if (vec.length === 1) {
        return vec[0]!;
    }
    return vec;
}

export function tvRemove<T>(vec: ThinVec<T>, value: T): ThinVec<T> {
    if (vec == null || vec === value) {
        return null;
    }
    if (!Array.isArray(vec)) {
        return vec; // not found (would have hit previous case)
    }
    const i = vec.indexOf(value);
    if (i < 0) {
        return vec; // not found
    }
    switch (vec.length) {
    case 1: return null;
    case 2: return i == 0 ? vec[1]! : vec[0]!;
    }
    vec.splice(i, 1);
    return vec;
}

export function tvLast<T>(vec: ThinVec<T>): T | undefined {
    if (vec === null) {
        return undefined;
    }
    if (!Array.isArray(vec)) {
        return vec;
    }
    return vec[vec.length - 1];
}

export function tvForEach<T>(vec: ThinVec<T>, func: (value: T) => void): void {
    if (vec === null) {
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
    let vec: ThinVec<number> = null;

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