import { ThinVec, tvPush, tvRemove, tvLength, tvForEach, tvLast, tvPop, tvEmpty } from './util';

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
    onupdate: UpdateHandler;
    onmount: () => void;
    onunmount: () => void;
}>;

type UpdateHandler = () => void | false;

function isConstValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function';
}


class Component<N extends Node | null = Node | null> {
    readonly #node: N;
    readonly #name: string;
    #container: Node | null = null;

    #parent: Component | null = null;
    #firstChild: Component | null = null;
    #lastChild: Component | null = null;
    #nextSibling: Component | null = null;
    #prevSibling: Component | null = null;

    #mounted = false;
    #mountHandlers: ThinVec<() => void> = tvEmpty;
    #unmountHandlers: ThinVec<() => void> = tvEmpty;
    #updateHandlers: ThinVec<() => void | false> = tvEmpty;
    #updateHandlerCount = 0; // count for subtree

    get node(): N { return this.#node; }
    get name(): string { return this.#name; }

    get parent(): Component | null { return this.#parent; }
    get firstChild(): Component | null { return this.#firstChild; }
    get lastChild(): Component | null { return this.#lastChild; }
    get nextSibling(): Component | null { return this.#nextSibling; }
    get prevSibling(): Component | null { return this.#prevSibling; }


    constructor(node: N, name?: string) {
        this.#node = node;
        this.#name = name ?? node?.nodeName ?? 'Fragment';
        this.#container = node;
    }

    mount(): Component<N> {
        this.#mount();
        this.update();
        return this;
    }

    update(): Component<N> {
        try {
            this.#update();
        } catch (e) {
            if (e !== 'cancel') {
                throw e;
            }
        }
        return this;
    }

    addMountHandler(handler: () => void): Component<N> {
        this.#mountHandlers = tvPush(this.#mountHandlers, handler);
        if (this.#mounted) {
            handler();
        }
        return this;
    }

    addUnmountHandler(handler: () => void): Component<N> {
        this.#unmountHandlers = tvPush(this.#unmountHandlers, handler);
        return this;
    }

    addUpdateHandler(handler: UpdateHandler): Component<N> {
        this.#updateHandlers = tvPush(this.#updateHandlers, handler);
        this.#addUpdateHandlerCount(1);
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (v: T) => void, equalCheck?: (a: T, b: T) => boolean): Component<N> {
        if (isConstValue(value)) {
            watcher(value);
            return this;
        }
        const eql = equalCheck ?? ((a, b) => a === b);
        const func = value as () => T;
        let val: T;
        let hasVal = false;
        this.addUpdateHandler(() => {
            const newVal = func();
            if (!hasVal || !eql(val, newVal)) {
                val = newVal;
                hasVal = true;
                watcher(newVal);
            }
        });
        return this;
    }

    setAttributes(attributes: Attributes<N> | null): Component<N> {
        for (const name in attributes) {
            const value = attributes[name]! as unknown as Value<Scalar>;

            if (typeof value === 'function' && name.startsWith('on')) {
                switch (name) {
                case 'onupdate':
                    this.addUpdateHandler(value as UpdateHandler);
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
        return this;
    }

    appendFragment(fragment: FragmentItem): Component<N> {
        iterateFragment(fragment, this.appendChild.bind(this));
        return this;
    }

    appendChild(child: Component): Component<N> {
        this.#attachComponent(child);
        return this;
    }

    insertBefore(child: Component, reference: Component | null): Component<N> {
        this.#attachComponent(child, reference);
        return this;
    }

    insertAfter(child: Component, reference: Component | null): Component<N> {
        this.insertBefore(child, reference?.nextSibling ?? null);
        return this;
    }

    replaceChild(replacement: Component, replaced: Component): Component<N> {
        this.#attachComponent(replacement, replaced);
        replaced.#detachFromParent();
        return this;
    }

    removeChild(child: Component): Component<N> {
        if (child.#parent !== this) {
            throw new Error('not child of this node');
        }
        child.#detachFromParent();
        return this;
    }

    appendChildren(children: Component[]): Component<N> {
        for (const child of children) {
            this.appendChild(child);
        }
        return this;
    }

    replaceChildren(children: Component[]): Component<N> {
        this.clear();
        this.appendChildren(children);
        return this;
    }

    clear(): Component<N> {
        for (;;) {
            const child = this.#firstChild;
            if (!child) {
                break;
            }
            child.#detachFromParent();
        }
        return this;
    }

    #mount(): void {
        if (this.#mounted) {
            throw new Error('already mounted');
        }
        this.#mounted = true;
        tvForEach(this.#mountHandlers, (handler) => {
            handler();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#mount();
        }
    }

    #unmount(): void {
        if (!this.#mounted) {
            throw new Error('not mounted');
        }
        this.#mounted = false;
        tvForEach(this.#unmountHandlers, (handler) => {
            handler();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#unmount();
        }
    }

    #update(): void {
        ++touchedComponents;
        if (this.#updateHandlerCount === 0) {
            return;
        }
        tvForEach(this.#updateHandlers, (handler) => {
            updaterCount += 1;
            if (handler() === false) {
                throw 'cancel';
            }
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#update();
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
            component.mount();
        }
        
        const container = this.#container;
        if (container) {
            component.#maybeSetChildContainerNode(container);

            const referenceNode = (before ? before.#getFirstNodeGoingForward() : this.#getLastNodeGoingBackward()?.nextSibling) ?? null;
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
    }

    #detachFromParent(): void {
        const parent = this.#parent;
        if (!parent) {
            throw new Error('component is not attached to parent');
        }

        if (this.#mounted) {
            this.#unmount();
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

    #getLastNodeGoingBackward(): Node | null {
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

    #addUpdateHandlerCount(diff: number): void {
        for (let c: Component | null = this; c; c = c.#parent) {
            c.#updateHandlerCount += diff;
        }
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


function printComponentTree(root: Component) {
    const result: string[] = [];
    recurse(root, 0);
    const text = result.join('');
    console.log(text);
    
    function recurse(component: Component, depth: number) {
        let indent = '';
        for (let i = 0; i < depth; ++i) {
            indent += '  ';
        }
        result.push(indent);
        result.push(component.name);
        if (component.node instanceof Text) {
            result.push(': ');
            result.push(JSON.stringify(component.node.nodeValue));
        }
        result.push('\n');
        for (let c = component.firstChild; c; c = c.nextSibling) {
            recurse(c, depth + 1);
        }
    }
}


function componentTreeSize(component: Component): number {
    let count = 1;
    for (let c = component.firstChild; c; c = c.nextSibling) {
        count += componentTreeSize(c);
    }
    return count;
}


function iterateFragment(fragment: FragmentItem, handler: (component: Component) => void): void {
    if (fragment === null || typeof fragment === 'undefined') {
        // ignore
    } else if (fragment instanceof Component) {
        handler(fragment);
    } else if (Array.isArray(fragment)) {
        for (const item of fragment) {
            iterateFragment(item, handler);
        }
    } else {
        handler(Txt(fragment));
    }
}


function flattenFragment(fragment: FragmentItem): Component[] {
    const components: Component[] = [];
    iterateFragment(fragment, components.push.bind(components));
    return components;
}


function fragmentToComponentOrNull(fragment: FragmentItem): Component | null {
    const components = flattenFragment(fragment);
    if (components.length === 0) {
        return null;
    }
    if (components.length === 1) {
        return components[0]!;
    }
    const component = new Component(null);
    component.appendFragment(components);
    return component;
}


function H<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Attributes<HTMLElementTagNameMap[K]> | null = null,
    ...children: FragmentItem[]
): Component<HTMLElementTagNameMap[K]>  {
    return new Component(document.createElement(tag))
        .setAttributes(attributes)
        .appendFragment(children);
}


function Txt(value: Value<Scalar>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node).addValueWatcher(value, (scalar) => {
        node.nodeValue = scalar?.toString() ?? '';
    });
}


function Fragment(...items: FragmentItem[]): Component {
    return new Component(null).appendFragment(items);
}


function With<T extends Scalar>(input: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component | null {
    if (isConstValue(input)) {
        return fragmentToComponentOrNull(mapper(input));
    }
    const root = new Component(null, name ?? 'With');
    const fragmentCache: Map<T, Component[]> = new Map();
    root.addValueWatcher(input, (v) => {
        let fragment = fragmentCache.get(v);
        if (typeof fragment === 'undefined') {
            fragment = flattenFragment(mapper(v));
            fragmentCache.set(v, fragment);
        }
        root.replaceChildren(fragment);
    });
    return root;
}


function If(
    predicate: Value<boolean>,
    thenFragment: FragmentItem,
    elseFragment?: FragmentItem
): Component | null {
    return With(predicate, (pred) => {
        return pred ? thenFragment : elseFragment;
    }, 'If');
}


function Match<T extends Scalar>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component | null {
    return With(value, (v: T) => {
        for (const [matcher, ...fragment] of cases) {
            if (typeof matcher === 'function' ? matcher(v) : v === matcher) {
                return fragment;
            }
        }
        return null;
    }, 'Match');
}
function Else<T>(_: T): true {
    return true;
}


function For<T extends { key: string }>(itemsValue: Value<T[]>, itemFunc: (item: T) => Component): Component {
    let components: { [key: string]: Component } = {};
    const root = new Component(null, 'For');

    root.addValueWatcher(itemsValue, (items) => {
        root.clear();
        for (const item of items) {
            root.appendChild(getComponent(item));
        }
    }, listsEqual);
    
    return root;

    function getComponent(item: T): Component {
        let component = components[item.key];
        if (!component) {
            component = itemFunc(item);
            components[item.key] = component;
        }
        return component;
    }

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
}






interface TodoItemModel {
    title: string;
    done: boolean;
    index: number;
    key: string;
}

class TodoListModel {
    private items: TodoItemModel[] = [];
    private keyCounter = 0;

    addItem(title: string): void {
        this.items = [...this.items, {
            title,
            done: false,
            index: this.items.length,
            key: (++this.keyCounter).toString()
        }];
    }

    setItemDone(key: string, done: boolean): void {
        this.items = this.items.map((item) => (item.key !== key ? item : { ...item, done }));
    }

    setAllDone = () => {
        this.items = this.items.map((item) => ({ ...item, done: true }));
    };

    setNoneDone = () => {
        this.items = this.items.map((item) => ({ ...item, done: true }));
    };

    getItems = () => {
        return this.items;
    };
}

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

function TodoListView(model: TodoListModel) {
    const input = H('input');
    return H('div', null,
        'Todo:',
        H('br'),
        input,
        H('button', {
            onclick() {
                model.addItem(input.node.value);
                input.node.value = '';
            }
        }, 'Add'),
        H('br'),
        H('button', {
            onclick: model.setNoneDone
        }, 'Select none'),
        H('button', {
            onclick: model.setAllDone
        }, 'Select all'),
        Match(() => model.getItems().length % 2,
            [0, 'even'],
            [1, Txt('odd')
                    .addMountHandler(() => console.log('mounted'))
                    .addUnmountHandler(() => console.log('unmounted'))]),
        For(model.getItems, TodoItemView),
    );
}




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
        const cb = H('input', { type: 'checkbox', onchange: () => {} });
        return [cb, () => cb.node.checked] as const;
    }
}



let updaterCount = 0;
let touchedComponents = 0;
function updateAll() {
    updaterCount = 0;
    touchedComponents = 0;
    bodyComponent.update();
    printComponentTree(bodyComponent);
    console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(bodyComponent), 'components.');
}

const todoListModel = new TodoListModel();
todoListModel.addItem('Bake bread');

const bodyComponent = new Component(document.body);
bodyComponent.appendChild(TodoListView(todoListModel));
bodyComponent.appendChild(TestComponent());
bodyComponent.mount();
