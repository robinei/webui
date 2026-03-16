import { type TestSuite, assert, assertEqual } from './runner';
import {
    deepEqual,
    type ThinVec, tvLength, tvLast, tvPush, tvPop, tvRemove,
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
    ],
};
