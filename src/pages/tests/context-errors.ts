import { Context, HTML, ErrorBoundary } from '../../core';
import { type TestSuite, withContainer, assert, assertEqual, assertThrows } from './runner';

const { div, span } = HTML;

export const contextErrorsSuite: TestSuite = {
    name: 'Context & Errors',
    tests: [
        {
            name: 'provideContext/getContext round-trip',
            run() {
                withContainer(container => {
                    const ctx = new Context<string>('test');
                    const parent = div();
                    parent.provideContext(ctx, 'hello');
                    container.appendChild(parent);
                    const child = span();
                    parent.appendChild(child);
                    assertEqual(child.getContext(ctx), 'hello');
                });
            },
        },
        {
            name: 'context traverses up the tree',
            run() {
                withContainer(container => {
                    const ctx = new Context<number>('num');
                    const root = div();
                    root.provideContext(ctx, 42);
                    container.appendChild(root);
                    const mid = div();
                    root.appendChild(mid);
                    const leaf = span();
                    mid.appendChild(leaf);
                    assertEqual(leaf.getContext(ctx), 42);
                });
            },
        },
        {
            name: 'getContext throws for missing context',
            run() {
                withContainer(container => {
                    const ctx = new Context<string>('missing');
                    const comp = div();
                    container.appendChild(comp);
                    assertThrows(() => comp.getContext(ctx), 'should throw for missing context');
                });
            },
        },
        {
            name: 'context overridden at deeper level',
            run() {
                withContainer(container => {
                    const ctx = new Context<string>('level');
                    const root = div();
                    root.provideContext(ctx, 'outer');
                    container.appendChild(root);
                    const mid = div();
                    mid.provideContext(ctx, 'inner');
                    root.appendChild(mid);
                    const leaf = span();
                    mid.appendChild(leaf);
                    assertEqual(leaf.getContext(ctx), 'inner');
                    // sibling at root level still sees outer
                    const sibling = span();
                    root.appendChild(sibling);
                    assertEqual(sibling.getContext(ctx), 'outer');
                });
            },
        },
        {
            name: 'Context.Consume renders with value',
            run() {
                withContainer(container => {
                    const ctx = new Context<string>('consume-test');
                    const root = div();
                    root.provideContext(ctx, 'consumed');
                    container.appendChild(root);
                    const consumer = ctx.Consume(val => span(val));
                    root.appendChild(consumer);
                    assert(container.node.textContent!.includes('consumed'),
                        'should render consumed value');
                });
            },
        },
        {
            name: 'ErrorBoundary catches synchronous error',
            run() {
                withContainer(container => {
                    const comp = ErrorBoundary(
                        (error) => span(`caught: ${error instanceof Error ? error.message : error}`),
                        () => { throw new Error('boom'); },
                    );
                    container.appendChild(comp);
                    assert(container.node.textContent!.includes('caught: boom'),
                        'should display caught error');
                });
            },
        },
        {
            name: 'ErrorBoundary catches error in child onmount',
            run() {
                withContainer(container => {
                    const comp = ErrorBoundary(
                        (error) => span(`mount-error: ${error instanceof Error ? error.message : error}`),
                        () => div({ onmount() { throw new Error('mount-fail'); } }),
                    );
                    container.appendChild(comp);
                    assert(container.node.textContent!.includes('mount-error: mount-fail'),
                        'should catch mount error');
                });
            },
        },
        {
            name: 'ErrorBoundary reset restores body',
            run() {
                withContainer(container => {
                    let shouldThrow = true;
                    const comp = ErrorBoundary(
                        (_error, reset) => {
                            shouldThrow = false;
                            // We need to trigger reset asynchronously, but for testing we can call it immediately
                            // since reset() calls initContent() which replaces the fallback with the body
                            return div(
                                span('error-state'),
                                div({ onmounted() { reset(); } }),
                            );
                        },
                        () => {
                            if (shouldThrow) throw new Error('first-fail');
                            return span('recovered');
                        },
                    );
                    container.appendChild(comp);
                    assert(container.node.textContent!.includes('recovered'),
                        'should show recovered state after reset');
                });
            },
        },
    ],
};
