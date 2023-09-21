
import { H, Lazy } from '../core';
import { asyncDelay, Semaphore } from '../util';

function benchmark(iters: number, func: () => void): number {
    const t0 = performance.now();
    for (let i = 0; i < iters; ++i) {
        func();
    }
    const t1 = performance.now();
    return Math.round(t1 - t0);
}

const lock = new Semaphore();

function Benchmark(desc: string, iters: number, func: () => void) {
    return [`${desc}: `, Lazy(async () => {
        await lock.acquire(); // ensure that they will start one after another (with 10 ms delay between each)
        try {
            await asyncDelay(10);
            const t = benchmark(iters, func);
            return ` ${t} ms`;
        } finally {
            lock.release();
        }
    }).appendFragment('...')];
}

export function BenchmarkPage() {
    const domIters = 100000;
    const argIters = 10000000;

    return H('div', null,
        'Benchmark results:',
        H('hr'),
        Benchmark('Component', domIters, () => {
            H('div', null,
                'foo',
                H('br'),
                H('div', null, 'bar'),
                'baz'
            );
        }),
        H('br'),
        Benchmark("Vanilla", domIters, () => {
            const topDiv = document.createElement('div');
            topDiv.appendChild(document.createTextNode('foo'));
            topDiv.appendChild(document.createElement('br'));
            const innerDiv = document.createElement('div');
            innerDiv.textContent = 'bar';
            topDiv.appendChild(innerDiv);
            topDiv.appendChild(document.createTextNode('baz'));
        }),
        H('hr'),
        Benchmark("Rest", argIters, () => {
            testRest(1,2,3,4,5,6,7,8,9);
        }),
        H('br'),
        Benchmark("Arguments", argIters, () => {
            testArguments(1,2,3,4,5,6,7,8,9);
        }),
    );
}


function testArguments(foo: number, ...numbers: number[]): number;
function testArguments() {
    var sum = 0;
    for (var i = 1; i < arguments.length; ++i) {
      sum += arguments[i];
    }
    return sum;
}


function testRest(foo: number, ...numbers: number[]) {
    var sum = 0;
    for (var i = 1; i < numbers.length; ++i) {
      sum += numbers[i]!;
    }
    return sum;
}
