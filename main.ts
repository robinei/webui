import { ThinVec, tvPush, tvRemove, tvLength, tvForEach, tvLast, tvPop } from './util';

type Scalar = null | undefined | string | number | boolean;

type Value<T> = T | (() => T);

type FragmentItem = Value<Scalar> | Component | FragmentItem[];

type Styles = {
    [K in keyof CSSStyleDeclaration as CSSStyleDeclaration[K] extends Function ? never : K]?: Value<CSSStyleDeclaration[K]>;
};

type AttributesImpl<T> = {
    [K in keyof T as T[K] extends (Function | null | undefined) ? (K extends `on${string}` ? K : never) : K]?:
        K extends 'style' ? Styles :
        T[K] extends (Function | null | undefined) ? T[K] : Value<T[K]>;
};

type Attributes<T> = AttributesImpl<T & {
    onupdate: () => void;
    onmount: () => void;
    onunmount: () => void;
}>;


const NULL = { _tag: 'NULL' } as const;

interface MountRoot {
    component: Component;
    mountPoint: Component<Node>;
}
const mountRoots: MountRoot[] = [];

var updaterCount = 0;
var touchedComponents = 0;
var skippedComponents = 0;
function updateAll() {
    updaterCount = 0;
    touchedComponents = 0;
    skippedComponents = 0;
    for (const root of mountRoots) {
        root.mountPoint.update();
    }
    console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'and skipped', skippedComponents, 'components.');
}


class Component<N extends Node | null = Node | null> {
    readonly #node: N;
    #container: Node | null = null;

    #parent: Component | null = null;
    #firstChild: Component | null = null;
    #lastChild: Component | null = null;
    #nextSibling: Component | null = null;
    #prevSibling: Component | null = null;

    updateGuard: (() => boolean) | undefined;
    #updateHandlers: ThinVec<() => void> = null;
    #updateHandlerCount = 0; // count for subtree
    
    #mounted = false;
    #mountHandlers: ThinVec<() => void> = null;
    #unmountHandlers: ThinVec<() => void> = null;

    get node(): N { return this.#node; }

    get parent(): Component | null { return this.#parent; }
    get firstChild(): Component | null { return this.#firstChild; }
    get lastChild(): Component | null { return this.#lastChild; }
    get nextSibling(): Component | null { return this.#nextSibling; }
    get prevSibling(): Component | null { return this.#prevSibling; }

    constructor(node: N) {
        this.#node = node;
        this.#container = node;
    }

    addUpdateHandler(handler: () => void): void {
        this.#updateHandlers = tvPush(this.#updateHandlers, handler);
        this.#addUpdateHandlerCount(1);
    }

    update(): void {
        ++touchedComponents;
        if (this.#updateHandlerCount === 0 || !(this.updateGuard?.() ?? true)) {
            skippedComponents += this.#treeSize() - 1;
            return;
        }
        tvForEach(this.#updateHandlers, (handler) => {
            updaterCount += 1;
            handler();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.update();
        }
    }

    addMountHandler(handler: () => void): void {
        this.#mountHandlers = tvPush(this.#mountHandlers, handler);
        if (this.#mounted) {
            handler();
        }
    }

    addUnmountHandler(handler: () => void): void {
        this.#unmountHandlers = tvPush(this.#unmountHandlers, handler);
    }

    addValueWatcher<T>(value: Value<T>, watcher: (v: T) => void, checkEqual: boolean = true): void {
        if (typeof value === 'function') {
            const func = value as () => T;
            let val: T | typeof NULL = NULL;
            this.addUpdateHandler(checkEqual ? () => {
                const newVal = func();
                if (val !== newVal) {
                    val = newVal;
                    watcher(newVal);
                }
            } : () => {
                watcher(func());
            });
        } else {
            watcher(value);
        }
    }

    setAttributes(attributes: Attributes<N>): void {
        for (const name in attributes) {
            const value = attributes[name]! as unknown as Value<Scalar>;

            if (typeof value === 'function' && name.startsWith('on')) {
                switch (name) {
                case 'onupdate':
                    this.addUpdateHandler(value);
                    break;
                case 'onmount':
                    this.addMountHandler(value);
                    break;
                case 'onunmount':
                    this.addUnmountHandler(value);
                    break;
                default:
                    this.#node?.addEventListener(name.substring(2), (ev) => {
                        (value as EventListener)(ev);
                        updateAll();
                    });
                    break;
                }
            } else if (name === 'style') {
                if (!(this.#node instanceof HTMLElement)) {
                    throw new Error('style attribute requires node to be HTMLElement');
                }
                const elem = this.#node;
                const styles = value as Styles;
                for (const styleName in styles) {
                    this.addValueWatcher(styles[styleName]!, (scalar) => {
                        elem.style[styleName] = scalar;
                    });
                }
            } else {
                if (!(this.#node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.#node;
                this.addValueWatcher(value, (scalar) => {
                    setElementAttribute(elem, name, scalar);
                });
            }
        }
    }

    appendFragment(fragment: FragmentItem): void {
        if (fragment === null || typeof fragment === 'undefined') {
            // ignore
        } else if (Array.isArray(fragment)) {
            for (const item of fragment) {
                this.appendFragment(item);
            }
        } else if (fragment instanceof Component) {
            this.appendChild(fragment);
        } else {
            this.appendChild(Txt(fragment));
        }
    }

    appendChild(child: Component): void {
        this.#attachComponent(child);
    }

    insertBefore(child: Component, reference: Component | null): void {
        this.#attachComponent(child, reference);
    }

    insertAfter(child: Component, reference: Component | null): void {
        this.insertBefore(child, reference?.nextSibling ?? null);
    }

    replaceChild(replacement: Component, replaced: Component): void {
        this.#attachComponent(replacement, replaced);
        replaced.#detachFromParent();
    }

    removeChild(child: Component): void {
        if (child.#parent !== this) {
            throw new Error('not child of this node');
        }
        child.#detachFromParent();
    }

    replaceChildren(children: Component[]): void {
        this.clear();
        for (const child of children) {
            this.appendChild(child);
        }
    }

    clear(): void {
        for (;;) {
            const child = this.#firstChild;
            if (!child) {
                break;
            }
            child.#detachFromParent();
        }
    }

    mount(mountPointNode: Node): void {
        if (this.#mounted) {
            throw new Error('already mounted');
        }
        if (this.#parent) {
            throw new Error('expected no parent component');
        }
        const mountPoint = new Component(mountPointNode);
        mountPoint.#doMount();
        mountPoint.appendChild(this);
        mountRoots.push({
            component: this,
            mountPoint
        });
    }

    unmount(): void {
        if (!this.#mounted) {
            throw new Error('not mounted');
        }
        for (let i = 0; i < mountRoots.length; ++i) {
            if (mountRoots[i]!.component === this) {
                mountRoots[i]!.mountPoint.clear();
                mountRoots.splice(i, 1);
                return;
            }
        }
        throw new Error('not among mounted components');
    }

    #treeSize(): number {
        let count = 1;
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            count += c.#treeSize();
        }
        return count;
    }

    #addUpdateHandlerCount(diff: number): void {
        let c: Component | null = this;
        while (c) {
            c.#updateHandlerCount += diff;
            c = c.#parent;
        }
    }

    #doMount(): void {
        if (this.#mounted) {
            throw new Error('already mounted');
        }
        this.#mounted = true;
        tvForEach(this.#mountHandlers, (handler) => {
            handler();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#doMount();
        }
    }

    #doUnmount(): void {
        if (!this.#mounted) {
            throw new Error('not mounted');
        }
        this.#mounted = false;
        tvForEach(this.#unmountHandlers, (handler) => {
            handler();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#doUnmount();
        }
    }

    #attachComponent(component: Component, before: Component | null = null): void {
        if (component === this) {
            throw new Error('cannot attach component to itself');
        }
        if (component.#parent) {
            throw new Error('component is already attached to a component');
        }
        
        if (this.#mounted) {
            component.update();
        }
        
        const container = this.#container;
        if (container) {
            component.#maybeSetChildContainerNode(container);

            const referenceNode = (before ? before.#getFirstNodeGoingForward() : this.#getFirstNodeGoingBackward()?.nextSibling) ?? null;
            component.#forEachNode((node) => {
                container.insertBefore(node, referenceNode);
            });
        }

        if (before) {
            if (before.#parent !== this) {
                throw new Error('reference component not child of this component');
            }
            if (before.#prevSibling) {
                before.#prevSibling.#nextSibling = component;
            } else {
                this.#firstChild = component;
            }
            before.#prevSibling = component;
            component.#prevSibling = before.#prevSibling;
        } else {
            if (this.#lastChild) {
                this.#lastChild.#nextSibling = component;
            } else {
                this.#firstChild = component;
            }
            component.#prevSibling = this.#lastChild;
            this.#lastChild = component;
        }
        component.#nextSibling = before;
        component.#parent = this;

        this.#addUpdateHandlerCount(component.#updateHandlerCount);

        if (this.#mounted) {
            component.#doMount();
        }
    }

    #detachFromParent(): void {
        const parent = this.#parent;
        if (!parent) {
            throw new Error('component is not attached to parent');
        }

        if (this.#mounted) {
            this.#doUnmount();
        }
        
        const container = parent.#container;
        if (container) {
            this.#forEachNode((node) => {
                container.removeChild(node);
            });
        }

        if (this.#prevSibling) {
            this.#prevSibling.#nextSibling = this.#nextSibling;
        } else {
            parent.#firstChild = this.#nextSibling;
        }
        if (this.#nextSibling) {
            this.#nextSibling.#prevSibling = this.#prevSibling;
        } else {
            parent.#lastChild = this.#prevSibling;
        }
        this.#prevSibling = null;
        this.#nextSibling = null;
        this.#parent = null;

        this.#maybeSetChildContainerNode(null);
        parent.#addUpdateHandlerCount(-this.#updateHandlerCount);
    }

    #maybeSetChildContainerNode(node: Node | null): void {
        if (this.#node) {
            // if this.#node is non-null then it will always be the child container node
            return;
        }
        this.#container = node;
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#maybeSetChildContainerNode(node);
        }
    }

    #forEachNode(handler: (node: Node) => void): void {
        if (this.#node) {
            handler(this.#node);
            return;
        }
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#forEachNode(handler);
        }
    }

    #getFirstNode(): Node | null {
        if (this.#node) {
            return this.#node;
        }
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            const node = c.#getFirstNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    #getLastNode(): Node | null {
        if (this.#node) {
            return this.#node;
        }
        for (let c = this.#lastChild; c; c = c.#prevSibling) {
            const node = c.#getLastNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    #getFirstNodeGoingBackward(): Node | null {
        for (let c: Component | null = this; c; c = c.#prevSibling) {
            const node = c.#getLastNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.#parent; parent && !parent.#node; parent = parent.#parent) {
            for (let c: Component | null = parent.#prevSibling; c; c = c.#prevSibling) {
                const node = c.#getLastNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    #getFirstNodeGoingForward(): Node | null {
        for (let c: Component | null = this; c; c = c.#nextSibling) {
            const node = c.#getFirstNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.#parent; parent && !parent.#node; parent = parent.#parent) {
            for (let c: Component | null = parent.#nextSibling; c; c = c.#nextSibling) {
                const node = c.#getFirstNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }
}

function setElementAttribute(elem: Element, name: string, value: Scalar): void {
    if (name in elem) {
        (elem as any)[name] = value;
    } else if (typeof value === 'boolean') {
        if (value) {
            elem.setAttribute(name, '');
        } else {
            elem.removeAttribute(name);
        }
    } else {
        if (value === null || value === undefined) {
            elem.removeAttribute(name);
        } else {
            elem.setAttribute(name, value.toString());
        }
    }
}


function H<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: null | Attributes<HTMLElementTagNameMap[K]> = null,
    ...children: FragmentItem[]
): Component<HTMLElementTagNameMap[K]>  {
    const component = new Component(document.createElement(tag));
    component.appendFragment(children);
    if (attributes) {
        component.setAttributes(attributes);
    }
    return component;
}


function Txt(value: Value<Scalar>): Component<Text> {
    const component = new Component(document.createTextNode(''));
    component.addValueWatcher(value, (scalar) => {
        component.node.nodeValue = scalar?.toString() ?? '';
    });
    return component;
}


function Fragment(...items: FragmentItem[]): Component {
    const component = new Component(null);
    component.appendFragment(items);
    const firstChild = component.firstChild;
    if (firstChild && !firstChild.nextSibling) {
        component.clear();
        return firstChild;
    }
    return component;
}


function FragmentOrNull(...items: FragmentItem[]): Component | null {
    const component = new Component(null);
    component.appendFragment(items);
    if (!component.firstChild) {
        return null;
    }
    const firstChild = component.firstChild;
    if (!firstChild.nextSibling) {
        component.clear();
        return firstChild;
    }
    return component;
}


function With<T>(input: Value<T>, mapper: (v: T) => FragmentItem | null): Component | null {
    if (typeof input !== 'function') {
        return FragmentOrNull(mapper(input));
    }
    const root = new Component(null);
    const componentCache: Map<T, Component | null> = new Map();
    root.addValueWatcher(input, (v) => {
        let component = componentCache.get(v);
        if (typeof component === 'undefined') {
            component = FragmentOrNull(mapper(v));
            componentCache.set(v, component);
        }
        root.clear();
        if (component) {
            root.appendChild(component);
        }
    });
    return root;
}


function If(
    predicate: Value<boolean>,
    thenFragment: FragmentItem,
    elseFragment?: FragmentItem
): Component | null {
    const thenComponent = FragmentOrNull(thenFragment);
    const elseComponent = FragmentOrNull(elseFragment);
    return With(predicate, (pred) => {
        return pred ? thenComponent : elseComponent;
    });
}


interface CaseEntry<T> {
    value: T | typeof NULL;
    component: Component | null;
}
function Case<T>(value: T, ...fragment: FragmentItem[]): CaseEntry<T> {
    const component = FragmentOrNull(fragment);
    return { value, component };
}
function Default<T>(...fragment: FragmentItem[]): CaseEntry<T> {
    const component = FragmentOrNull(fragment);
    return { value: NULL, component };
}
function Switch<T>(value: Value<T>, ...cases: CaseEntry<T>[]): Component | null {
    const caseMap: Map<T, Component | null> = new Map();
    let defaultComponent: Component | null = null;
    let foundDefault = false;
    for (const c of cases) {
        if (foundDefault) {
            throw new Error('Default expected to be last, if present');
        }
        if (c.value === NULL) {
            defaultComponent = c.component;
            foundDefault = true;
        } else {
            caseMap.set(c.value as T, c.component);
        }
    }
    return With(value, (v: T) => {
        const component = caseMap.get(v);
        if (typeof component !== 'undefined') {
            return component;
        }
        return defaultComponent;
    });
}


function For<T extends { key: string }>(itemsValue: Value<T[]>, itemFunc: (item: T) => Component): Component {
    let prevItems: T[] = [];
    let components: { [key: string]: Component } = {};

    function getComponent(item: T): Component {
        let component = components[item.key];
        if (!component) {
            component = itemFunc(item);
            components[item.key] = component;
        }
        return component;
    }

    const root = new Component(null);
    root.addUpdateHandler(() => {
        const items = typeof itemsValue === 'function' ? itemsValue() : itemsValue;

        if (listsEqual(prevItems, items)) {
            return;
        }

        root.clear();
        for (const item of items) {
            root.appendChild(getComponent(item));
        }
    });

    function listsEqual(a: T[], b: T[]): boolean {
        if (a.length != b.length) {
            return false;
        }
        for (let i = 0; i < a.length; ++i) {
            if (a[i]!.key !== b[i]!.key) {
                return false;
            }
        }
        return true;
    }

    return root;
}


function Button(props: {
    title: Value<string>;
    onclick(): void;
}) {
    return H('div', {
            className: 'button',
            onclick: props.onclick
        },
        H('b', null, props.title)
    );
}




With(1, (v) => {
    switch (v) {
    case 1: return 'foo';
    case 2: return 'bar';
    default: return null;
    }
});

Switch(1,
    Case(1, "foo"),
    Case(2, "bar"),
    Default(null));


function TodoItemView(item: TodoItemModel) {
    return H('div', {
            onclick() { item.done = !item.done; },
            style: {
                cursor: 'pointer',
                backgroundColor: () => (item.index % 2) ? '#aaaaaa' : '#ffffff',
            }
        },
        H('input', {
            type: 'checkbox',
            checked: () => item.done,
            onchange(ev) {
                item.done = (ev.target as any).checked;
            }
        }),
        () => item.title,
        If(() => item.done, ' - Done')
    );
}

function TodoListView(items: TodoItemModel[]) {
    const input = H('input');
    return H('div', {
            onupdate() {
                for (let i = 0; i < items.length; ++i) {
                    items[i]!.index = i;
                }
            }
        },
        'Todo:',
        H('br'),
        input,
        H('button', {
            onclick() {
                items.push(createTodoItem(input.node.value));
                input.node.value = '';
            }
        }, 'Add'),
        H('br'),
        H('button', {
            onclick() { for (const item of items) item.done = false; }
        }, 'Select none'),
        H('button', {
            onclick() { for (const item of items) item.done = true; }
        }, 'Select all'),
        If(() => !(items.length % 2),
            'even',
            H('span', {
                onmount() {
                    console.log('mounted');
                },
                onunmount() {
                    console.log('unmounted');
                },
            }, 'odd')
        ),
        For(items, TodoItemView),
    );
}



interface TodoItemModel {
    title: string;
    done: boolean;
    index: number;
    key: string;
}

let keyCounter = 0;
function createTodoItem(title: string): TodoItemModel {
    return {
        title,
        done: false,
        index: 0,
        key: (++keyCounter).toString()
    };
}

const todoItems: TodoItemModel[] = [
    createTodoItem('Bake bread'),
    //createTodoItem('Sell laptop'),
];

TodoListView(todoItems).mount(document.body);



function TestComponent() {
    const [cb1, checked1] = CheckBox();
    const [cb2, checked2] = CheckBox();
    const [cb3, checked3] = CheckBox();
    const [cb4, checked4] = CheckBox();

    return Fragment(
        cb1, H('br'),
        cb2, H('br'),
        cb3, H('br'),
        cb4, H('br'),
        If(checked1,
            H('span', null, 'a')),
        If(checked2,
            If(checked3,
                H('span', null, 'b'),
                H('span', null, 'c'))),
        If(checked4,
            H('span', null, 'd')),
    );

    function CheckBox() {
        const cb = H('input', { type: 'checkbox', onchange: updateAll });
        return [cb, () => cb.node.checked] as const;
    }
}

TestComponent().mount(document.body);
