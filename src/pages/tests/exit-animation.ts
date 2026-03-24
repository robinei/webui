import { HTML, When, For } from '../../core';
import { type TestSuite, withContainer, assert, assertEqual } from './runner';

const { div, span } = HTML;

export const exitAnimationSuite: TestSuite = {
    name: 'Exit Animation',
    tests: [
        {
            name: 'DOM lingers until done() is called',
            run() {
                withContainer(container => {
                    let doneFn: (() => void) | undefined;
                    const comp = span('exiting', {
                        onexit(_done) { doneFn = _done; },
                    });
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'exiting');

                    container.removeChild(comp);
                    // DOM should still be present
                    assertEqual(container.node.textContent, 'exiting');
                    assert(!!doneFn, 'done function should have been provided');

                    doneFn!();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'tree is unlinked immediately, unmount fires immediately',
            run() {
                withContainer(container => {
                    let unmounted = false;
                    let doneFn: (() => void) | undefined;
                    const comp = span('child', {
                        onexit(done) { doneFn = done; },
                        onunmount() { unmounted = true; },
                    });
                    container.appendChild(comp);
                    container.removeChild(comp);

                    // Tree is unlinked
                    assertEqual(comp.getParent(), undefined);
                    // Unmount fired
                    assert(unmounted, 'unmount should fire immediately');
                    // But DOM lingers
                    assertEqual(container.node.textContent, 'child');

                    // Clean up so withContainer's clear() doesn't leak
                    doneFn!();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'For: removed items linger until done()',
            run() {
                withContainer(container => {
                    let doneFns: (() => void)[] = [];
                    let items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }];
                    const comp = For(() => items, item => span(() => item().t, {
                        onexit(done) { doneFns.push(done); },
                    }), item => item.id);
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'abc');

                    // Remove middle item
                    items = [{ id: 1, t: 'a' }, { id: 3, t: 'c' }];
                    container.update();

                    // All 3 spans still in DOM (removed one lingers)
                    assertEqual(container.node.querySelectorAll('span').length, 3);
                    assertEqual(doneFns.length, 1);

                    // Call done — now only 2 spans
                    doneFns[0]!();
                    assertEqual(container.node.querySelectorAll('span').length, 2);
                    assertEqual(container.node.textContent, 'ac');
                });
            },
        },
        {
            name: 'When: content lingers on toggle false until done()',
            run() {
                withContainer(container => {
                    let show = true;
                    let doneFn: (() => void) | undefined;
                    const comp = When(() => show,
                        span('visible', {
                            onexit(done) { doneFn = done; },
                        }),
                    );
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'visible');

                    show = false;
                    container.update();
                    // DOM lingers
                    assertEqual(container.node.textContent, 'visible');
                    assert(!!doneFn, 'done should have been provided');

                    doneFn!();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 're-insertion during exit cancels exit',
            run() {
                withContainer(container => {
                    let doneFn: (() => void) | undefined;
                    const comp = span('item', {
                        onexit(done) { doneFn = done; },
                    });
                    container.appendChild(comp);
                    container.removeChild(comp);

                    // DOM lingers, component is unlinked
                    assertEqual(container.node.textContent, 'item');
                    assertEqual(comp.getParent(), undefined);

                    // Re-insert — should cancel exit and place fresh
                    container.appendChild(comp);
                    assertEqual(comp.getParent(), container);
                    assertEqual(container.node.textContent, 'item');

                    // Calling old done() should be safe (no-op)
                    doneFn!();
                    assertEqual(container.node.textContent, 'item');
                });
            },
        },
        {
            name: 'done() called twice is safe',
            run() {
                withContainer(container => {
                    let doneFn: (() => void) | undefined;
                    const comp = span('x', {
                        onexit(done) { doneFn = done; },
                    });
                    container.appendChild(comp);
                    container.removeChild(comp);
                    doneFn!();
                    doneFn!(); // should not throw
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'throwing exit handler cleans up immediately',
            run() {
                withContainer(container => {
                    const comp = span('throw', {
                        onexit() { throw new Error('exit boom'); },
                    });
                    container.appendChild(comp);
                    // Suppress console.error for this test
                    const origError = console.error;
                    let errorLogged = false;
                    console.error = () => { errorLogged = true; };
                    try {
                        container.removeChild(comp);
                    } finally {
                        console.error = origError;
                    }
                    assert(errorLogged, 'error should have been logged');
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'cancelExit before removal prevents exit animation',
            run() {
                withContainer(container => {
                    const comp = span('cancel-before', {
                        onexit() { throw new Error('should not be called'); },
                    });
                    container.appendChild(comp);
                    comp.cancelExit();
                    container.removeChild(comp);
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'cancelExit during exit removes lingering DOM',
            run() {
                withContainer(container => {
                    let doneFn: (() => void) | undefined;
                    const comp = span('cancel-during', {
                        onexit(done) { doneFn = done; },
                    });
                    container.appendChild(comp);
                    container.removeChild(comp);

                    // DOM lingers
                    assertEqual(container.node.textContent, 'cancel-during');
                    assert(!!doneFn, 'done should have been provided');

                    // Cancel exit — DOM should be removed immediately
                    comp.cancelExit();
                    assertEqual(container.node.textContent, '');

                    // Old done() is now a no-op
                    doneFn!();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'forceClear removes all children including exiting ones',
            run() {
                withContainer(container => {
                    let doneFns: (() => void)[] = [];
                    const a = span('a', { onexit(done) { doneFns.push(done); } });
                    const b = span('b', { onexit(done) { doneFns.push(done); } });
                    const c = span('c');
                    container.appendChild(a);
                    container.appendChild(b);
                    container.appendChild(c);
                    assertEqual(container.node.textContent, 'abc');

                    // Remove a and b — they linger
                    container.removeChild(a);
                    container.removeChild(b);
                    assertEqual(container.node.textContent, 'abc');
                    assertEqual(doneFns.length, 2);

                    // forceClear — everything gone, including lingering DOM
                    container.forceClear();
                    assertEqual(container.node.textContent, '');

                    // Old done() calls are no-ops
                    doneFns[0]!();
                    doneFns[1]!();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'nested removal: only parent exit handler fires',
            run() {
                withContainer(container => {
                    let parentExitCalled = false;
                    let childExitCalled = false;
                    let parentDone: (() => void) | undefined;
                    const child = span('inner', {
                        onexit() { childExitCalled = true; },
                    });
                    const parent = div({
                        onexit(done) { parentExitCalled = true; parentDone = done; },
                    }, child);
                    container.appendChild(parent);

                    container.removeChild(parent);
                    assert(parentExitCalled, 'parent exit handler should fire');
                    assert(!childExitCalled, 'child exit handler should NOT fire when parent is removed');

                    // Clean up lingering DOM
                    parentDone!();
                });
            },
        },
    ],
};
