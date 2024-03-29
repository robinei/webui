
import { FragmentItem, HTML, Lazy, Immediate } from '../core';
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

const { div, hr, br, b, h4, h5 } = HTML;

function Benchmark(desc: string, iters: number, func: () => void) {
    return div(
        `${desc}: `,
        Lazy(async () => {
            await lock.acquire(); // ensure that they will start one after another (with 10 ms delay between each)
            try {
                await asyncDelay(10);
                const t = benchmark(iters, func);
                return [b(t), ' ms'];
            } finally {
                lock.release();
            }
        }).appendFragment('...') // appended fragment will be replaced when Lazy content resolves
    );
}

export function BenchmarkPage(): FragmentItem {
    const domIters = 100000;
    const argIters = 10000000;

    return Immediate(div(
        h4('Benchmarks'),
        h5('DOM creation'),
        Benchmark('Component', domIters, () => {
            div(
                'foo',
                br(),
                div('bar'),
                'baz'
            );
        }),
        Benchmark('Vanilla', domIters, () => {
            const topDiv = document.createElement('div');
            topDiv.appendChild(document.createTextNode('foo'));
            topDiv.appendChild(document.createElement('br'));
            const innerDiv = document.createElement('div');
            innerDiv.textContent = 'bar';
            topDiv.appendChild(innerDiv);
            topDiv.appendChild(document.createTextNode('baz'));
        }),
        hr(),
        h5('Variable argument passing'),
        Benchmark('Rest', argIters, () => {
            testRest(1,2,3,4,5,6,7,8,9);
        }),
        Benchmark('Arguments', argIters, () => {
            testArguments(1,2,3,4,5,6,7,8,9);
        }),
    ));
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
