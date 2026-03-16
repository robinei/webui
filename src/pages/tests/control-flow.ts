import { HTML, If, When, Unless, Match, Else, For, Repeat } from '../../core';
import { type TestSuite, withContainer, assertEqual } from './runner';

const { div, span } = HTML;

export const controlFlowSuite: TestSuite = {
    name: 'Control Flow',
    tests: [
        {
            name: 'If shows then-branch when true',
            run() {
                withContainer(container => {
                    const comp = If(true, span('yes'), span('no'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'yes');
                });
            },
        },
        {
            name: 'If shows else-branch when false',
            run() {
                withContainer(container => {
                    const comp = If(false, span('yes'), span('no'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'no');
                });
            },
        },
        {
            name: 'If switches branches on update',
            run() {
                withContainer(container => {
                    let cond = true;
                    const comp = If(() => cond, span('yes'), span('no'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'yes');
                    cond = false;
                    container.update();
                    assertEqual(container.node.textContent, 'no');
                    cond = true;
                    container.update();
                    assertEqual(container.node.textContent, 'yes');
                });
            },
        },
        {
            name: 'If with no else renders nothing when false',
            run() {
                withContainer(container => {
                    const comp = If(false, span('yes'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'When shows content when true',
            run() {
                withContainer(container => {
                    const comp = When(true, span('visible'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'visible');
                });
            },
        },
        {
            name: 'When hides content when false',
            run() {
                withContainer(container => {
                    const comp = When(false, span('hidden'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'When toggles on update',
            run() {
                withContainer(container => {
                    let show = true;
                    const comp = When(() => show, span('toggled'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'toggled');
                    show = false;
                    container.update();
                    assertEqual(container.node.textContent, '');
                    show = true;
                    container.update();
                    assertEqual(container.node.textContent, 'toggled');
                });
            },
        },
        {
            name: 'Unless is inverse of When',
            run() {
                withContainer(container => {
                    let cond = false;
                    const comp = Unless(() => cond, span('shown'));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'shown');
                    cond = true;
                    container.update();
                    assertEqual(container.node.textContent, '');
                });
            },
        },
        {
            name: 'Match selects correct branch by value',
            run() {
                withContainer(container => {
                    let val: string = 'a';
                    const comp = Match(
                        () => val,
                        ['a', span('alpha')],
                        ['b', span('beta')],
                        ['c', span('gamma')],
                    );
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'alpha');
                    val = 'b';
                    container.update();
                    assertEqual(container.node.textContent, 'beta');
                    val = 'c';
                    container.update();
                    assertEqual(container.node.textContent, 'gamma');
                });
            },
        },
        {
            name: 'Match with predicate function',
            run() {
                withContainer(container => {
                    const comp = Match(
                        42,
                        [(v: number) => v > 100, span('big')],
                        [(v: number) => v > 10, span('medium')],
                        [(v: number) => v > 0, span('small')],
                    );
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'medium');
                });
            },
        },
        {
            name: 'Match with Else fallback',
            run() {
                withContainer(container => {
                    const comp = Match(
                        'z',
                        ['a', span('alpha')],
                        [Else, span('fallback')],
                    );
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'fallback');
                });
            },
        },
        {
            name: 'For renders list of items',
            run() {
                withContainer(container => {
                    const items = [{ id: 1, text: 'one' }, { id: 2, text: 'two' }, { id: 3, text: 'three' }];
                    const comp = For(items, item => span(item.text), item => item.id);
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'onetwothree');
                });
            },
        },
        {
            name: 'For reconciles on addition/removal/reorder',
            run() {
                withContainer(container => {
                    let items = [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }];
                    const comp = For(() => items, item => span(() => item().text), item => item.id);
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'abc');

                    // Capture DOM nodes for reuse check
                    const nodes = Array.from(container.node.querySelectorAll('span'));
                    assertEqual(nodes.length, 3);

                    // Reorder and add
                    items = [{ id: 3, text: 'c' }, { id: 1, text: 'a' }, { id: 4, text: 'd' }];
                    container.update();
                    assertEqual(container.node.textContent, 'cad');

                    // Check that existing DOM nodes were reused (not recreated)
                    const newNodes = Array.from(container.node.querySelectorAll('span'));
                    assertEqual(newNodes[0], nodes[2]); // id:3 kept its node
                    assertEqual(newNodes[1], nodes[0]); // id:1 kept its node
                });
            },
        },
        {
            name: 'For: partial update with no moves reuses all nodes',
            run() {
                withContainer(container => {
                    const items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }];
                    const comp = For(() => items, item => span(() => item().t), item => item.id);
                    container.appendChild(comp);
                    const nodesBefore = Array.from(container.node.querySelectorAll('span'));
                    items[1]!.t = 'B';
                    container.update();
                    assertEqual(container.node.textContent, 'aBc');
                    const nodesAfter = Array.from(container.node.querySelectorAll('span'));
                    // All nodes reused — no moves, sorted fast path
                    for (let i = 0; i < 3; i++) assertEqual(nodesAfter[i], nodesBefore[i]);
                });
            },
        },
        {
            name: 'For: swap two rows',
            run() {
                withContainer(container => {
                    let items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 4, t: 'd' }];
                    const comp = For(() => items, item => span(item().t), item => item.id);
                    container.appendChild(comp);
                    const nodes = Array.from(container.node.querySelectorAll('span'));
                    // Swap first and last
                    items = [{ id: 4, t: 'd' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 1, t: 'a' }];
                    container.update();
                    assertEqual(container.node.textContent, 'dbca');
                    const newNodes = Array.from(container.node.querySelectorAll('span'));
                    assertEqual(newNodes[0], nodes[3]); // id:4 reused
                    assertEqual(newNodes[1], nodes[1]); // id:2 reused
                    assertEqual(newNodes[2], nodes[2]); // id:3 reused
                    assertEqual(newNodes[3], nodes[0]); // id:1 reused
                });
            },
        },
        {
            name: 'For: full reverse reuses all nodes',
            run() {
                withContainer(container => {
                    let items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
                    const comp = For(() => items, item => span(`${item().id}`), item => item.id);
                    container.appendChild(comp);
                    const nodes = Array.from(container.node.querySelectorAll('span'));
                    items = [...items].reverse();
                    container.update();
                    assertEqual(container.node.textContent, '54321');
                    const newNodes = Array.from(container.node.querySelectorAll('span'));
                    for (let i = 0; i < 5; i++) assertEqual(newNodes[i], nodes[4 - i]);
                });
            },
        },
        {
            name: 'For: two interleaved sequences [0,8,1,9,2,10,3] — LIS picks longer run',
            run() {
                withContainer(container => {
                    // ids arranged so new order has indices [0,8,1,9,2,10,3] — LIS length 4
                    const makeItems = (ids: number[]) => ids.map(id => ({ id, t: `${id}` }));
                    let items = makeItems([0, 1, 2, 3, 8, 9, 10]); // initial sorted order
                    const comp = For(() => items, item => span(item().t), item => item.id);
                    container.appendChild(comp);
                    const nodeById = new Map(Array.from(container.node.querySelectorAll('span')).map(
                        (n, i) => [items[i]!.id, n]
                    ));
                    // Reorder to interleaved: [0,8,1,9,2,10,3]
                    items = makeItems([0, 8, 1, 9, 2, 10, 3]);
                    container.update();
                    assertEqual(container.node.textContent, '0819 2103'.replace(/ /g, ''));
                    // All original nodes reused
                    const newNodes = Array.from(container.node.querySelectorAll('span'));
                    for (const node of newNodes) {
                        assertEqual(nodeById.get(Number(node.textContent)), node);
                    }
                });
            },
        },
        {
            name: 'For: remove all items then repopulate',
            run() {
                withContainer(container => {
                    let items = [{ id: 1 }, { id: 2 }, { id: 3 }];
                    const comp = For(() => items, item => span(`${item().id}`), item => item.id);
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, '123');
                    items = [];
                    container.update();
                    assertEqual(container.node.textContent, '');
                    items = [{ id: 4 }, { id: 5 }];
                    container.update();
                    assertEqual(container.node.textContent, '45');
                });
            },
        },
        {
            name: 'Repeat renders N items, adjusts on count change',
            run() {
                withContainer(container => {
                    let count = 3;
                    const comp = Repeat(() => count, i => span(`item${i}`));
                    container.appendChild(comp);
                    assertEqual(container.node.textContent, 'item0item1item2');
                    count = 5;
                    container.update();
                    assertEqual(container.node.textContent, 'item0item1item2item3item4');
                    count = 1;
                    container.update();
                    assertEqual(container.node.textContent, 'item0');
                });
            },
        },
    ],
};
