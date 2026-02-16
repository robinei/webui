import { Component, HTML, DynamicText, StaticText } from '../../core';
import { TestSuite, withContainer, assert, assertEqual } from './runner';

const { div, span, button } = HTML;

export const reactivitySuite: TestSuite = {
    name: 'Reactivity',
    tests: [
        {
            name: 'DynamicText shows initial value and updates after update()',
            run() {
                withContainer(container => {
                    let count = 0;
                    const text = DynamicText(() => `count: ${count}`);
                    container.appendChild(text);
                    assertEqual(text.node.nodeValue, 'count: 0');
                    count = 5;
                    container.update();
                    assertEqual(text.node.nodeValue, 'count: 5');
                });
            },
        },
        {
            name: 'static attribute set once',
            run() {
                withContainer(container => {
                    const d = div({ id: 'test-static' });
                    container.appendChild(d);
                    assertEqual(d.node.id, 'test-static');
                });
            },
        },
        {
            name: 'thunk attribute updates on update()',
            run() {
                withContainer(container => {
                    let cls = 'a';
                    const d = div({ className: () => cls });
                    container.appendChild(d);
                    assertEqual(d.node.className, 'a');
                    cls = 'b';
                    container.update();
                    assertEqual(d.node.className, 'b');
                });
            },
        },
        {
            name: 'style object sets inline styles',
            run() {
                withContainer(container => {
                    const d = div({ style: { color: 'red', fontWeight: 'bold' } });
                    container.appendChild(d);
                    assertEqual(d.node.style.color, 'red');
                    assertEqual(d.node.style.fontWeight, 'bold');
                });
            },
        },
        {
            name: 'style thunk updates on update()',
            run() {
                withContainer(container => {
                    let color = 'red';
                    const d = div({ style: { color: () => color } });
                    container.appendChild(d);
                    assertEqual(d.node.style.color, 'red');
                    color = 'blue';
                    container.update();
                    assertEqual(d.node.style.color, 'blue');
                });
            },
        },
        {
            name: 'addValueWatcher fires immediately for static value',
            run() {
                withContainer(container => {
                    let received: string | null = null;
                    const comp = div();
                    container.appendChild(comp);
                    comp.addValueWatcher('hello', function (v) { received = v; });
                    assertEqual(received, 'hello');
                });
            },
        },
        {
            name: 'addValueWatcher fires on update for thunk',
            run() {
                withContainer(container => {
                    let val = 1;
                    let received = 0;
                    const comp = div();
                    container.appendChild(comp);
                    comp.addValueWatcher(() => val, function (v) { received = v; });
                    assertEqual(received, 1);
                    val = 2;
                    container.update();
                    assertEqual(received, 2);
                });
            },
        },
        {
            name: 'addValueWatcher skips equal values',
            run() {
                withContainer(container => {
                    let val = 1;
                    let callCount = 0;
                    const comp = div();
                    container.appendChild(comp);
                    comp.addValueWatcher(() => val, function () { callCount++; });
                    assertEqual(callCount, 1);
                    container.update(); // same value
                    assertEqual(callCount, 1);
                    val = 2;
                    container.update();
                    assertEqual(callCount, 2);
                });
            },
        },
        {
            name: 'boolean attribute toggles disabled',
            run() {
                withContainer(container => {
                    let disabled = true;
                    const btn = button('click', { disabled: () => disabled });
                    container.appendChild(btn);
                    assertEqual((btn.node as HTMLButtonElement).disabled, true);
                    disabled = false;
                    container.update();
                    assertEqual((btn.node as HTMLButtonElement).disabled, false);
                });
            },
        },
        {
            name: 'multiple thunks update independently',
            run() {
                withContainer(container => {
                    let a = 'x';
                    let b = 'y';
                    const d = div({ id: () => a, title: () => b });
                    container.appendChild(d);
                    assertEqual(d.node.id, 'x');
                    assertEqual(d.node.title, 'y');
                    a = 'xx';
                    container.update();
                    assertEqual(d.node.id, 'xx');
                    assertEqual(d.node.title, 'y');
                    b = 'yy';
                    container.update();
                    assertEqual(d.node.title, 'yy');
                });
            },
        },
    ],
};
