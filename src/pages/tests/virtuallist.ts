import { VirtualList } from '../../core';
import { HTML } from '../../core';
import { type TestSuite, assert, assertEqual, withContainer } from './runner';

const { span } = HTML;

export const virtualListSuite: TestSuite = {
    name: 'VirtualList',
    tests: [
        {
            name: 'renders visible items on mount',
            run() {
                withContainer(container => {
                    const items = Array.from({ length: 20 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items,
                        estimateSize: 50,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '200px' });
                    container.appendChild(vl);
                    // 200px / 50px = 4 visible, buffer=3 → items 0..6 rendered
                    assert(vl.node.textContent!.includes('item-0'), 'item-0 should be rendered');
                    assert(!vl.node.textContent!.includes('item-19'), 'item-19 should not be rendered');
                });
            },
        },
        {
            name: 'does not render items outside visible range',
            run() {
                withContainer(container => {
                    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items,
                        estimateSize: 50,
                        buffer: 0,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '100px' });
                    container.appendChild(vl);
                    // 100px / 50px = 2 visible, buffer=0 → only items 0 and 1
                    assert(vl.node.textContent!.includes('item-0'));
                    assert(vl.node.textContent!.includes('item-1'));
                    assert(!vl.node.textContent!.includes('item-2'), 'item-2 outside viewport with no buffer');
                });
            },
        },
        {
            name: 'scroll updates visible set',
            run() {
                withContainer(container => {
                    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items,
                        estimateSize: 50,
                        buffer: 0,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '100px' });
                    container.appendChild(vl);
                    assert(vl.node.textContent!.includes('item-0'), 'item-0 visible before scroll');

                    // Scroll so item 20 is first visible (offset 1000)
                    vl.node.scrollTop = 1000;
                    vl.node.dispatchEvent(new Event('scroll'));
                    assert(vl.node.textContent!.includes('item-20'), 'item-20 visible after scroll');
                    assert(!vl.node.textContent!.includes('item-0'), 'item-0 not visible after scroll');
                });
            },
        },
        {
            name: 'scrollToIndex sets scroll position',
            run() {
                withContainer(container => {
                    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items,
                        estimateSize: 50,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '200px' });
                    container.appendChild(vl);
                    vl.scrollToIndex(10);
                    assertEqual(vl.node.scrollTop, 500); // 10 * 50
                });
            },
        },
        {
            name: 'replaces items — stale wrappers removed, new ones rendered',
            run() {
                withContainer(container => {
                    let items = Array.from({ length: 20 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items: () => items,
                        estimateSize: 50,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '200px' });
                    container.appendChild(vl);
                    assert(vl.node.textContent!.includes('item-0'));

                    items = Array.from({ length: 20 }, (_, i) => ({ id: i + 100 }));
                    vl.updateRoot();
                    assert(vl.node.textContent!.includes('item-100'), 'new items rendered');
                    assert(!vl.node.textContent!.includes('item-0'), 'stale items removed');
                });
            },
        },
        {
            name: 'same key reuses wrapper DOM node across re-renders',
            run() {
                withContainer(container => {
                    let items = [{ id: 1 }, { id: 2 }, { id: 3 }];
                    const vl = new VirtualList({
                        items: () => items,
                        estimateSize: 50,
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '300px' });
                    container.appendChild(vl);
                    const spansBefore = Array.from(vl.node.querySelectorAll('span'));

                    items = [{ id: 1 }, { id: 2 }, { id: 3 }]; // new array, same keys
                    vl.updateRoot();
                    const spansAfter = Array.from(vl.node.querySelectorAll('span'));
                    assertEqual(spansBefore[0], spansAfter[0], 'wrapper for key 1 reused');
                    assertEqual(spansBefore[1], spansAfter[1], 'wrapper for key 2 reused');
                    assertEqual(spansBefore[2], spansAfter[2], 'wrapper for key 3 reused');
                });
            },
        },
        {
            name: 'horizontal mode — scrollToIndex sets scrollLeft',
            run() {
                withContainer(container => {
                    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
                    const vl = new VirtualList({
                        items,
                        estimateSize: 80,
                        direction: 'horizontal',
                        key: x => x.id,
                        render: item => span(`item-${item.id}`),
                    });
                    vl.setStyle({ height: '100px', width: '320px' });
                    container.appendChild(vl);
                    vl.scrollToIndex(5);
                    assertEqual(vl.node.scrollLeft, 400); // 5 * 80
                });
            },
        },
    ],
};
