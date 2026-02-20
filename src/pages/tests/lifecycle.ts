import { HTML } from '../../core';
import { type TestSuite, withContainer, assert, assertEqual } from './runner';

const { div, span } = HTML;

export const lifecycleSuite: TestSuite = {
    name: 'Lifecycle',
    tests: [
        {
            name: 'onmount fires when component is mounted',
            run() {
                withContainer(container => {
                    let mounted = false;
                    const comp = div({ onmount() { mounted = true; } });
                    assert(!mounted, 'should not be mounted yet');
                    container.appendChild(comp);
                    assert(mounted, 'should be mounted after appendChild');
                });
            },
        },
        {
            name: 'onmounted fires after mount',
            run() {
                withContainer(container => {
                    let mountedFired = false;
                    const comp = div({ onmounted() { mountedFired = true; } });
                    container.appendChild(comp);
                    assert(mountedFired, 'onmounted should fire after appendChild');
                });
            },
        },
        {
            name: 'onunmount fires when removed',
            run() {
                withContainer(container => {
                    let unmounted = false;
                    const comp = div({ onunmount() { unmounted = true; } });
                    container.appendChild(comp);
                    assert(!unmounted, 'should not be unmounted yet');
                    container.removeChild(comp);
                    assert(unmounted, 'should be unmounted after removeChild');
                });
            },
        },
        {
            name: 'onupdate fires on every update() call',
            run() {
                withContainer(container => {
                    let updateCount = 0;
                    const comp = div({ onupdate() { updateCount++; } });
                    container.appendChild(comp);
                    // update fires once on mount
                    const afterMount = updateCount;
                    container.update();
                    assertEqual(updateCount, afterMount + 1);
                    container.update();
                    assertEqual(updateCount, afterMount + 2);
                });
            },
        },
        {
            name: 'mount order: parent onmount before child onmount',
            run() {
                withContainer(container => {
                    const order: string[] = [];
                    const child = span({ onmount() { order.push('child'); } });
                    const parent = div({ onmount() { order.push('parent'); } }, child);
                    container.appendChild(parent);
                    assertEqual(order[0], 'parent');
                    assertEqual(order[1], 'child');
                });
            },
        },
        {
            name: 'onmounted fires after all onmount in subtree',
            run() {
                withContainer(container => {
                    const order: string[] = [];
                    const child = span({
                        onmount() { order.push('child-mount'); },
                        onmounted() { order.push('child-mounted'); },
                    });
                    const parent = div({
                        onmount() { order.push('parent-mount'); },
                        onmounted() { order.push('parent-mounted'); },
                    }, child);
                    container.appendChild(parent);
                    // onmount fires parent-first, then onmounted fires after all onmounts
                    assertEqual(order[0], 'parent-mount');
                    assertEqual(order[1], 'child-mount');
                    // onmounted should come after both mounts
                    assert(order.indexOf('parent-mounted') > order.indexOf('child-mount'),
                        'parent-mounted should fire after child-mount');
                    assert(order.indexOf('child-mounted') > order.indexOf('child-mount'),
                        'child-mounted should fire after child-mount');
                });
            },
        },
        {
            name: 'onunmount fires for entire subtree',
            run() {
                withContainer(container => {
                    const unmounted: string[] = [];
                    const grandchild = span({ onunmount() { unmounted.push('grandchild'); } });
                    const child = div({ onunmount() { unmounted.push('child'); } }, grandchild);
                    const parent = div({ onunmount() { unmounted.push('parent'); } }, child);
                    container.appendChild(parent);
                    container.removeChild(parent);
                    assert(unmounted.includes('parent'), 'parent should unmount');
                    assert(unmounted.includes('child'), 'child should unmount');
                    assert(unmounted.includes('grandchild'), 'grandchild should unmount');
                });
            },
        },
        {
            name: 'onupdate returning false skips subtree',
            run() {
                withContainer(container => {
                    let childUpdated = false;
                    const child = span({ onupdate() { childUpdated = true; } });
                    const parent = div({ onupdate() { return false; } }, child);
                    container.appendChild(parent);
                    // Reset after mount
                    childUpdated = false;
                    container.update();
                    assert(!childUpdated, 'child onupdate should not fire when parent returns false');
                });
            },
        },
    ],
};
