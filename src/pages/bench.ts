
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
    return Lazy(async () => {
        await lock.acquire();
        await asyncDelay(10);
        try {
            const t = benchmark(iters, func);
            return `${desc}: ${t} ms`;
        } finally {
            lock.release();
        }
    });
}

export function BenchmarkPage() {
    const N = 100000;
    return H('div', null,
        'Benchmark results:',
        H('br'),
        Benchmark('Component', N, () => {
            H('div', null,
                'foo',
                H('br'),
                H('div', null, 'bar'),
                'baz'
            );
        }),
        H('br'),
        Benchmark("Vanilla", N, () => {
            const topDiv = document.createElement('div');
            topDiv.appendChild(document.createTextNode('foo'));
            topDiv.appendChild(document.createElement('br'));
            const innerDiv = document.createElement('div');
            innerDiv.textContent = 'bar';
            topDiv.appendChild(innerDiv);
            topDiv.appendChild(document.createTextNode('baz'));
        }));
}
