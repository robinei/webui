import { Component, HTML, StaticText, DynamicText, flattenFragment } from '../../core';
import { TestSuite, withContainer, assert, assertEqual, assertThrows } from './runner';

const { div, span, p } = HTML;

export const componentTreeSuite: TestSuite = {
    name: 'Component Tree',
    tests: [
        {
            name: 'HTML proxy creates correct element types',
            run() {
                const d = div();
                assert(d.node instanceof HTMLDivElement, 'div should create HTMLDivElement');
                const s = span();
                assert(s.node instanceof HTMLSpanElement, 'span should create HTMLSpanElement');
                const para = p();
                assert(para.node instanceof HTMLParagraphElement, 'p should create HTMLParagraphElement');
            },
        },
        {
            name: 'HTML proxy sets text content',
            run() {
                const d = div('hello');
                assertEqual(d.node.textContent, 'hello');
            },
        },
        {
            name: 'HTML proxy nests children',
            run() {
                const child = span('inner');
                const parent = div(child);
                assertEqual(parent.getFirstChild(), child);
                assertEqual(child.getParent(), parent);
                assert(parent.node.contains(child.node), 'DOM should contain child node');
            },
        },
        {
            name: 'appendChild sets parent/child pointers',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span();
                    parent.appendChild(child);
                    assertEqual(child.getParent(), parent);
                    assertEqual(parent.getFirstChild(), child);
                    assertEqual(parent.getLastChild(), child);
                });
            },
        },
        {
            name: 'appendChild adds DOM node to container',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span('test');
                    parent.appendChild(child);
                    assert(parent.node.contains(child.node), 'parent DOM should contain child DOM');
                });
            },
        },
        {
            name: 'insertBefore places child before reference',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const a = span('a');
                    const b = span('b');
                    parent.appendChild(b);
                    parent.insertBefore(a, b);
                    assertEqual(parent.getFirstChild(), a);
                    assertEqual(a.getNextSibling(), b);
                    assertEqual(b.getPrevSibling(), a);
                });
            },
        },
        {
            name: 'insertAfter places child after reference',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const a = span('a');
                    const b = span('b');
                    parent.appendChild(a);
                    parent.insertAfter(b, a);
                    assertEqual(a.getNextSibling(), b);
                    assertEqual(b.getPrevSibling(), a);
                    assertEqual(parent.getLastChild(), b);
                });
            },
        },
        {
            name: 'removeChild clears parent pointer',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span();
                    parent.appendChild(child);
                    parent.removeChild(child);
                    assertEqual(child.getParent(), undefined);
                    assertEqual(parent.getFirstChild(), undefined);
                });
            },
        },
        {
            name: 'removeChild removes DOM node',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span('gone');
                    parent.appendChild(child);
                    parent.removeChild(child);
                    assertEqual(parent.node.childNodes.length, 0);
                });
            },
        },
        {
            name: 'removeFromParent removes self',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span();
                    parent.appendChild(child);
                    child.removeFromParent();
                    assertEqual(child.getParent(), undefined);
                    assertEqual(parent.getFirstChild(), undefined);
                });
            },
        },
        {
            name: 'clear removes all children',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    parent.appendChild(span('a'));
                    parent.appendChild(span('b'));
                    parent.appendChild(span('c'));
                    parent.clear();
                    assertEqual(parent.getFirstChild(), undefined);
                    assertEqual(parent.node.childNodes.length, 0);
                });
            },
        },
        {
            name: 'replaceChild swaps one child for another',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const a = span('a');
                    const b = span('b');
                    parent.appendChild(a);
                    parent.replaceChild(b, a);
                    assertEqual(parent.getFirstChild(), b);
                    assertEqual(a.getParent(), undefined);
                    assertEqual(b.getParent(), parent);
                });
            },
        },
        {
            name: 'replaceChildren reorders via LIS reconciliation',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const a = span('a');
                    const b = span('b');
                    const c = span('c');
                    parent.appendChild(a);
                    parent.appendChild(b);
                    parent.appendChild(c);
                    // reverse order
                    parent.replaceChildren([c, b, a]);
                    assertEqual(parent.getFirstChild(), c);
                    assertEqual(c.getNextSibling(), b);
                    assertEqual(b.getNextSibling(), a);
                    assertEqual(parent.getLastChild(), a);
                    // check DOM order
                    assertEqual(parent.node.childNodes[0], c.node);
                    assertEqual(parent.node.childNodes[1], b.node);
                    assertEqual(parent.node.childNodes[2], a.node);
                });
            },
        },
        {
            name: 'sibling pointers correct after multiple operations',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const a = span('a');
                    const b = span('b');
                    const c = span('c');
                    parent.appendChild(a);
                    parent.appendChild(b);
                    parent.appendChild(c);
                    parent.removeChild(b);
                    assertEqual(a.getNextSibling(), c);
                    assertEqual(c.getPrevSibling(), a);
                    assertEqual(a.getPrevSibling(), undefined);
                    assertEqual(c.getNextSibling(), undefined);
                });
            },
        },
        {
            name: 'getRoot traverses to root',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const child = span();
                    parent.appendChild(child);
                    const grandchild = span();
                    child.appendChild(grandchild);
                    assertEqual(grandchild.getRoot(), container.getRoot());
                });
            },
        },
        {
            name: 'cannot appendChild to self',
            run() {
                const d = div();
                assertThrows(() => d.appendChild(d), 'should throw when appending to self');
            },
        },
        {
            name: 'appendFragment flattens nested arrays',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    parent.appendFragment(['a', [span('b'), ['c']]]);
                    const children = parent.getChildren();
                    assertEqual(children.length, 3);
                    assertEqual((children[0].node as Text).nodeValue, 'a');
                    assert(children[1].node instanceof HTMLSpanElement);
                    assertEqual((children[2].node as Text).nodeValue, 'c');
                });
            },
        },
        {
            name: 'null components pass DOM children to parent container',
            run() {
                withContainer(container => {
                    const parent = div();
                    container.appendChild(parent);
                    const nullComp = new Component(null, 'NullTest');
                    parent.appendChild(nullComp);
                    const child = span('visible');
                    nullComp.appendChild(child);
                    // child's DOM node should be in parent's DOM since nullComp has no node
                    assert(parent.node.contains(child.node), 'null component child should appear in parent DOM');
                });
            },
        },
        {
            name: 'StaticText creates text node with correct value',
            run() {
                const t = StaticText('hello world');
                assert(t.node instanceof Text, 'should be a Text node');
                assertEqual(t.node.nodeValue, 'hello world');
            },
        },
    ],
};
