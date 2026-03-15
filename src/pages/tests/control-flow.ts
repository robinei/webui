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
