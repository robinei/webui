import { type TestSuite, assert, assertEqual } from './runner';
import {
    deepEqual, arraysEqual,
    type ThinVec, tvLength, tvLast, tvPush, tvPop, tvRemove,
    longestIncreasingSubsequence,
} from '../../util';

export const utilSuite: TestSuite = {
    name: 'Utilities',
    tests: [
        // deepEqual tests
        {
            name: 'deepEqual: equal numbers',
            run() {
                assert(deepEqual(1, 1));
                assert(!deepEqual(1, 2));
            },
        },
        {
            name: 'deepEqual: equal strings',
            run() {
                assert(deepEqual('a', 'a'));
                assert(!deepEqual('a', 'b'));
            },
        },
        {
            name: 'deepEqual: different types',
            run() {
                assert(!deepEqual('a', 1));
            },
        },
        {
            name: 'deepEqual: arrays',
            run() {
                assert(deepEqual([1], [1]));
                assert(!deepEqual([1], [2]));
                assert(!deepEqual([1], [1, 2]));
            },
        },
        {
            name: 'deepEqual: objects',
            run() {
                assert(deepEqual({ a: 1 }, { a: 1 }));
                assert(!deepEqual({ a: 1 }, { a: 2 }));
            },
        },
        {
            name: 'deepEqual: nested structures',
            run() {
                assert(deepEqual({ a: [1] }, { a: [1] }));
                assert(!deepEqual({ a: [1] }, { a: [2] }));
                assert(!deepEqual({ a: [1] }, { b: [1] }));
                assert(!deepEqual({ a: [1] }, { a: [1], b: 2 }));
                assert(!deepEqual({ a: [1], b: 2 }, { a: [1] }));
                assert(deepEqual({ a: [1], b: 2 }, { a: [1], b: 2 }));
            },
        },

        // ThinVec tests
        {
            name: 'ThinVec: push and remove',
            run() {
                let vec: ThinVec<number>;
                vec = tvPush(vec, 0);
                vec = tvPush(vec, 1);
                vec = tvPush(vec, 2);
                assertEqual(tvLength(vec), 3);
                assertEqual(tvLast(vec), 2);
                vec = tvRemove(vec, 2);
                assertEqual(tvLength(vec), 2);
                assertEqual(tvLast(vec), 1);
                vec = tvRemove(vec, 1);
                assertEqual(tvLength(vec), 1);
                assertEqual(tvLast(vec), 0);
                vec = tvRemove(vec, 0);
                assertEqual(tvLength(vec), 0);
                assertEqual(tvLast(vec), undefined);
            },
        },
        {
            name: 'ThinVec: push and pop',
            run() {
                let vec: ThinVec<number>;
                vec = tvPush(vec, 0);
                vec = tvPush(vec, 1);
                vec = tvPush(vec, 2);
                assertEqual(tvLength(vec), 3);
                assertEqual(tvLast(vec), 2);
                vec = tvPop(vec);
                assertEqual(tvLength(vec), 2);
                assertEqual(tvLast(vec), 1);
                vec = tvPop(vec);
                assertEqual(tvLength(vec), 1);
                assertEqual(tvLast(vec), 0);
                vec = tvPop(vec);
                assertEqual(tvLength(vec), 0);
                assertEqual(tvLast(vec), undefined);
            },
        },

        // LIS tests
        {
            name: 'LIS: empty array',
            run() {
                assert(arraysEqual(longestIncreasingSubsequence([]), []));
            },
        },
        {
            name: 'LIS: single element',
            run() {
                assert(arraysEqual(longestIncreasingSubsequence([5]), [0]));
            },
        },
        {
            name: 'LIS: already sorted',
            run() {
                assert(arraysEqual(longestIncreasingSubsequence([1, 2, 3, 4]), [0, 1, 2, 3]));
            },
        },
        {
            name: 'LIS: reversed',
            run() {
                assertEqual(longestIncreasingSubsequence([4, 3, 2, 1]).length, 1);
            },
        },
        {
            name: 'LIS: mixed sequence',
            run() {
                const arr = [1, 3, 4, 0, 2];
                const lis = longestIncreasingSubsequence(arr);
                assertEqual(lis.length, 3);
                // indices are increasing
                assert(lis[0]! < lis[1]! && lis[1]! < lis[2]!);
                // values are increasing
                for (let i = 1; i < lis.length; i++) {
                    assert(arr[lis[i]!]! > arr[lis[i - 1]!]!);
                }
            },
        },
        {
            name: 'LIS: classic sequence [3,1,4,1,5,9,2,6]',
            run() {
                assertEqual(longestIncreasingSubsequence([3, 1, 4, 1, 5, 9, 2, 6]).length, 4);
            },
        },
        {
            name: 'LIS: all duplicates',
            run() {
                assertEqual(longestIncreasingSubsequence([2, 2, 2, 2]).length, 1);
            },
        },
        {
            name: 'LIS: two interleaved sequences',
            run() {
                assertEqual(longestIncreasingSubsequence([0, 8, 1, 9, 2, 10, 3]).length, 4);
            },
        },
    ],
};
