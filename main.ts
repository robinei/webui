import { ThinVec, tvPush, tvForEach, tvEmpty, calcLevenshteinOperations, listsEqual, WritableKeys } from './util';

type Primitive = null | undefined | string | number | boolean | symbol;

type Value<T> = T | (() => T);

type FragmentItem = Value<Primitive> | Component | FragmentItem[];

type Styles = {
    [K in keyof CSSStyleDeclaration as CSSStyleDeclaration[K] extends Function ? never : K]?: Value<CSSStyleDeclaration[K]>;
};

type PropertyAttributes<N> = {
    [K in keyof N as
        K extends string ? (
            N[K] extends (Function | null | undefined) ? never :
            K extends WritableKeys<N> ? (N[K] extends Primitive ? K : never) :
            K extends 'style' ? K : never
        ) : never
    ]?: K extends 'style' ? Styles : Value<N[K]>;
};

type EventAttributes<N> = {
    [K in keyof N as
        K extends string ? (
            N[K] extends (Function | null | undefined) ?
                (K extends `on${string}` ? K : never) :
                never
        ) : never
    ]?: RewriteThisParameter<N[K]>;
};

type ComponentAttributes = {
    onmount?: MountListener;
    onunmount?: UnmountListener;
    onupdate?: UpdateListener;
};

type Attributes<N> = PropertyAttributes<N> & EventAttributes<N> & ComponentAttributes;

type MountListener = (this: Component) => void;
type UnmountListener = (this: Component) => void;
type UpdateListener = (this: Component) => void | false;

type RewriteThisParameter<F> =
    F extends (this: infer _, ...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret :
    F extends (...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret : never;


class Context<_> {
    #name: string;
    get name(): string { return this.#name; }
    constructor(name: string) { this.#name = name; }
}


class Component<N extends Node | null = Node | null> {
    readonly #node: N;
    readonly #name: string | undefined;
    #container: Node | null = null;

    #parent: Component | null = null;
    #firstChild: Component | null = null;
    #lastChild: Component | null = null;
    #nextSibling: Component | null = null;
    #prevSibling: Component | null = null;

    #mounted = false;
    #mountListeners: ThinVec<() => void> = tvEmpty;
    #unmountListeners: ThinVec<() => void> = tvEmpty;
    #updateListeners: ThinVec<() => void | false> = tvEmpty;
    #updateListenerCount = 0; // count for subtree

    #contextValues: Map<Context<unknown>, unknown> | undefined;

    get node(): N { return this.#node; }
    get name(): string { return this.#name ?? this.#node?.nodeName ?? 'Group'; }

    get parent(): Component | null { return this.#parent; }
    get firstChild(): Component | null { return this.#firstChild; }
    get lastChild(): Component | null { return this.#lastChild; }
    get nextSibling(): Component | null { return this.#nextSibling; }
    get prevSibling(): Component | null { return this.#prevSibling; }

    get root(): Component {
        let c: Component = this;
        while (c.parent) {
            c = c.parent;
        }
        return c;
    }

    constructor(node: N, name?: string) {
        this.#node = node;
        this.#name = name;
        this.#container = node;
    }

    addMountListener(listener: MountListener): Component<N> {
        const boundListener = listener.bind(this);
        this.#mountListeners = tvPush(this.#mountListeners, boundListener);
        if (this.#mounted) {
            boundListener();
        }
        return this;
    }

    addUnmountListener(listener: UnmountListener): Component<N> {
        this.#unmountListeners = tvPush(this.#unmountListeners, listener.bind(this));
        return this;
    }

    addUpdateListener(listener: UpdateListener): Component<N> {
        this.#updateListeners = tvPush(this.#updateListeners, listener.bind(this));
        this.#addUpdateListenerCount(1);
        return this;
    }

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => any): Component<N> {
        if (!this.#node) {
            throw new Error('addEventListener called on node-less component');
        }
        const boundListener = listener.bind(this);
        this.#node.addEventListener(type, (ev: any) => {
            boundListener(ev);
            this.#updateRoot();
        });
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck?: (a: T, b: T) => boolean): Component<N> {
        const boundWatcher = watcher.bind(this);
        if (isConstValue(value)) {
            boundWatcher(value);
            return this;
        }
        const eql = equalCheck ?? ((a, b) => a === b);
        const func = value as () => T;
        let val: T;
        let hasVal = false;
        this.addUpdateListener(() => {
            const newVal = func();
            if (!hasVal || !eql(val, newVal)) {
                val = newVal;
                hasVal = true;
                boundWatcher(newVal);
            }
        });
        return this;
    }

    provideContext<T>(context: Context<T>, value: T): Component<N> {
        if (!this.#contextValues) {
            this.#contextValues = new Map();
        }
        this.#contextValues.set(context, value);
        return this;
    }

    getContext<T>(context: Context<T>): T {
        for (let c: Component | null = this; c; c = c.#parent) {
            if (c.#contextValues) {
                const value = c.#contextValues.get(context);
                if (value !== undefined) {
                    return value as T;
                }
            }
        }
        throw new Error('context not provided: ' + context.name);
    }

    setAttributes(attributes: Attributes<N> | null): Component<N> {
        for (const name in attributes) {
            const value = attributes[name]! as unknown as Value<Primitive>;

            if (typeof value === 'function' && name.startsWith('on')) {
                switch (name) {
                case 'onupdate':
                    this.addUpdateListener(value as any);
                    break;
                case 'onmount':
                    this.addMountListener(value);
                    break;
                case 'onunmount':
                    this.addUnmountListener(value);
                    break;
                default:
                    this.addEventListener(name.substring(2) as any, value as any);
                    break;
                }
            } else if (name === 'style') {
                if (!(this.#node instanceof HTMLElement)) {
                    throw new Error('style attribute requires node to be HTMLElement');
                }
                const elem = this.#node;
                const styles = value as Styles;
                for (const styleName in styles) {
                    this.addValueWatcher(styles[styleName]!, (primitive) => {
                        elem.style[styleName] = primitive;
                    });
                }
            } else {
                if (!(this.#node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.#node;
                this.addValueWatcher(value, (primitive) => {
                    setElementAttribute(elem, name, primitive);
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

    appendChildren(children: Component[]): Component<N> {
        for (const child of children) {
            this.appendChild(child);
        }
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

    removeChild(child: Component): Component<N> {
        if (child.#parent !== this) {
            throw new Error('not child of this node');
        }
        child.#detachFromParent();
        return this;
    }

    replaceChild(replacement: Component, replaced: Component): Component<N> {
        if (replacement === replaced) {
            return this;
        }
        this.#attachComponent(replacement, replaced);
        replaced.#detachFromParent();
        return this;
    }

    replaceChildren(children: Component[]): Component<N> {
        const operations = calcLevenshteinOperations(this.getChildren(), children);
        for (const op of operations) {
            switch (op.type) {
            case 'replace': this.replaceChild(op.newValue, op.oldValue); break;
            case 'insert': this.insertBefore(op.value, op.before); break;
            case 'remove': this.removeChild(op.value); break;
            }
        }
        return this;
    }

    getChildren(): Component[] {
        const children: Component[] = [];
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            children.push(c);
        }
        return children;
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

    mount(): Component<N> {
        this.#mount();
        this.update();
        return this;
    }

    update(): Component<N> {
        if (!this.#mounted) {
            return this;
        }
        ++touchedComponents;
        let skipSubtree = false;
        tvForEach(this.#updateListeners, (listener) => {
            updaterCount += 1;
            if (listener() === false) {
                skipSubtree = true;
            }
        });
        if (!skipSubtree) {
            for (let c = this.#firstChild; c; c = c.#nextSibling) {
                if (c.#updateListenerCount > 0) {
                    c.update();
                }
            }
        }
        return this;
    }

    #mount(): void {
        if (this.#mounted) {
            throw new Error('already mounted');
        }
        this.#mounted = true;
        tvForEach(this.#mountListeners, (listener) => {
            listener();
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
        tvForEach(this.#unmountListeners, (listener) => {
            listener();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#unmount();
        }
    }

    #attachComponent(component: Component, before: Component | null = null): void {
        if (component === this) {
            throw new Error('cannot attach component to itself');
        }
        if (component.#parent) {
            throw new Error('component is already attached to a component');
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
            component.#prevSibling = before.#prevSibling;
            before.#prevSibling = component;
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

        this.#addUpdateListenerCount(component.#updateListenerCount);
        
        if (this.#mounted) {
            component.mount();
        }
        
        const container = this.#container;
        if (container) {
            const referenceNode = (before ? before.#getFirstNodeGoingForward() : component.#getLastNodeGoingBackward(false)?.nextSibling) ?? null;
            component.#maybeSetChildContainerNode(container);
            component.#forEachNode((node) => {
                container.insertBefore(node, referenceNode);
            });
        }
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
        parent.#addUpdateListenerCount(-this.#updateListenerCount);
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

    #getLastNodeGoingBackward(includeSelf: boolean = true): Node | null {
        for (let c: Component | null = includeSelf ? this : this.#prevSibling; c; c = c.#prevSibling) {
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

    #getFirstNodeGoingForward(includeSelf: boolean = true): Node | null {
        for (let c: Component | null = includeSelf ? this : this.#nextSibling; c; c = c.#nextSibling) {
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

    #addUpdateListenerCount(diff: number): void {
        for (let c: Component | null = this; c; c = c.#parent) {
            c.#updateListenerCount += diff;
        }
    }
    
    #updateRoot() {
        updaterCount = 0;
        touchedComponents = 0;
        const root = this.root;
        root.update();
        console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(root), 'components.');
    }
}

let updaterCount = 0;
let touchedComponents = 0;


function isConstValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function';
}


function setElementAttribute(elem: Element, name: string, value: Primitive): void {
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


function dumpComponentTree(root: Component): string {
    const result: string[] = [];
    recurse(root, 0);
    return result.join('');
    
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
    if (fragment === null || fragment === undefined) {
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


function H<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Attributes<HTMLElementTagNameMap[K]> | null = null,
    ...children: FragmentItem[]
): Component<HTMLElementTagNameMap[K]>  {
    return new Component(document.createElement(tag))
        .setAttributes(attributes)
        .appendFragment(children);
}


function Txt(value: Value<Primitive>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node).addValueWatcher(value, (primitive) => {
        node.nodeValue = primitive?.toString() ?? '';
    });
}


function Group(...items: FragmentItem[]): Component {
    return new Component(null).appendFragment(items);
}


function With<T extends Primitive>(input: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component | Component[] {
    if (isConstValue(input)) {
        return flattenFragment(mapper(input));
    }
    const root = new Component(null, name ?? 'With');
    const fragmentCache: Map<T, Component[]> = new Map();
    root.addValueWatcher(input, (v) => {
        let fragment = fragmentCache.get(v);
        if (fragment === undefined) {
            fragment = flattenFragment(mapper(v));
            fragmentCache.set(v, fragment);
        }
        root.replaceChildren(fragment);
    });
    return root;
}


function If(predicate: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component | Component[] {
    return With(predicate, (pred) => pred ? thenFragment : elseFragment, 'If');
}


function Match<T extends Primitive>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component | Component[] {
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


function For<T>(itemsValue: Value<T[]>, itemFunc: (item: T) => FragmentItem): Component | Component[] {
    if (isConstValue(itemsValue)) {
        return flattenFragment(itemsValue.map(itemFunc));
    }

    let map = new Map<T, Component[]>();
    let newMap: Map<T, Component[]>;
    const root = new Component(null, 'For');

    root.addValueWatcher(itemsValue, (items) => {
        newMap = new Map();
        root.replaceChildren(items.map(getItemFragment).flat());
        map = newMap;
    }, listsEqual);
    
    return root;

    function getItemFragment(item: T): Component[] {
        let fragment = map.get(item);
        if (!fragment) {
            fragment = flattenFragment(itemFunc(item));
        }
        newMap.set(item, fragment);
        return fragment;
    }
}






interface TodoItemModel {
    title: string;
    done: boolean;
    index: number;
}

class TodoListModel {
    private items: TodoItemModel[] = [];

    addItem(title: string) {
        this.items = [...this.items, {
            title,
            done: false,
            index: this.items.length,
        }];
        return this;
    }

    setAllDone = () => {
        for (const item of this.items) {
            item.done = true;
        }
        return this;
    };

    setNoneDone = () => {
        for (const item of this.items) {
            item.done = false;
        }
        return this;
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
            onchange(ev: Event) {
                item.done = (ev.target as any).checked;
            }
        }),
        () => item.title,
        If(() => item.done, ' - Done')
    );
}

const TestContext = new Context<string>('TestContext');

function TodoListView(model: TodoListModel) {
    const input = H('input');
    return H('div', null,
        H('button', {
            onclick() {
                console.log(dumpComponentTree(this.root));
            }
        }, 'Print tree'),
        H('button', {
            onclick() {}
        }, 'Update'),
        H('br'),
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
                    .addMountListener(function () {
                        console.log('mounted');
                        console.log('TestContext:', this.getContext(TestContext));
                    })
                    .addUnmountListener(function () {
                        console.log('unmounted');
                    })]),
        For(model.getItems, TodoItemView),
    ).provideContext(TestContext, 'foobar');
}




function TestComponent() {
    const [cb1, checked1] = CheckBox();
    const [cb2, checked2] = CheckBox();
    const [cb3, checked3] = CheckBox();
    const [cb4, checked4] = CheckBox();

    return Group(
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



new Component(document.body).appendChildren([
    TodoListView(new TodoListModel().addItem('Bake bread')),
    TestComponent(),
]).mount();
