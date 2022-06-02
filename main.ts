import { ThinVec, tvPush, tvForEach, tvEmpty, calcLevenshteinOperations, listsEqual } from './util';

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
    onmount: MountHandler;
    onunmount: UnmountHandler;
}>;

type MountHandler = (this: Component) => void;
type UnmountHandler = (this: Component) => void;
type UpdateHandler = (this: Component) => void | false;

class Context<T> {
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
    #mountHandlers: ThinVec<() => void> = tvEmpty;
    #unmountHandlers: ThinVec<() => void> = tvEmpty;
    #updateHandlers: ThinVec<() => void | false> = tvEmpty;
    #updateHandlerCount = 0; // count for subtree

    #contextValues: Map<Context<unknown>, unknown> | undefined;

    get node(): N { return this.#node; }
    get name(): string { return this.#name ?? this.#node?.nodeName ?? 'Fragment'; }

    get parent(): Component | null { return this.#parent; }
    get firstChild(): Component | null { return this.#firstChild; }
    get lastChild(): Component | null { return this.#lastChild; }
    get nextSibling(): Component | null { return this.#nextSibling; }
    get prevSibling(): Component | null { return this.#prevSibling; }


    constructor(node: N, name?: string) {
        this.#node = node;
        this.#name = name;
        this.#container = node;
    }

    addMountHandler(handler: MountHandler): Component<N> {
        const boundHandler = handler.bind(this);
        this.#mountHandlers = tvPush(this.#mountHandlers, boundHandler);
        if (this.#mounted) {
            boundHandler();
        }
        return this;
    }

    addUnmountHandler(handler: UnmountHandler): Component<N> {
        this.#unmountHandlers = tvPush(this.#unmountHandlers, handler.bind(this));
        return this;
    }

    addUpdateHandler(handler: UpdateHandler): Component<N> {
        this.#updateHandlers = tvPush(this.#updateHandlers, handler.bind(this));
        this.#addUpdateHandlerCount(1);
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component, v: T) => void, equalCheck?: (a: T, b: T) => boolean): Component<N> {
        const boundWatcher = watcher.bind(this);
        if (isConstValue(value)) {
            boundWatcher(value);
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
        ++touchedComponents;
        let skipSubtree = false;
        tvForEach(this.#updateHandlers, (handler) => {
            updaterCount += 1;
            if (handler() === false) {
                skipSubtree = true;
            }
        });
        if (!skipSubtree) {
            for (let c = this.#firstChild; c; c = c.#nextSibling) {
                if (c.#updateHandlerCount > 0) {
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

        this.#addUpdateHandlerCount(component.#updateHandlerCount);
        
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

    #addUpdateHandlerCount(diff: number): void {
        for (let c: Component | null = this; c; c = c.#parent) {
            c.#updateHandlerCount += diff;
        }
    }
}


function isConstValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function';
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


function fragmentToComponent(fragment: FragmentItem): Component {
    const components = flattenFragment(fragment);
    if (components.length === 1) {
        return components[0]!;
    }
    const component = new Component(null);
    component.appendFragment(components);
    return component;
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


function With<T extends Scalar>(input: Value<T>, mapper: (v: T) => FragmentItem, name?: string): FragmentItem {
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


function If(
    predicate: Value<boolean>,
    thenFragment: FragmentItem,
    elseFragment?: FragmentItem
): FragmentItem {
    return With(predicate, (pred) => {
        return pred ? thenFragment : elseFragment;
    }, 'If');
}


function Match<T extends Scalar>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): FragmentItem {
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


function For<T extends object>(itemsValue: Value<T[]>, itemFunc: (item: T) => FragmentItem): FragmentItem {
    if (isConstValue(itemsValue)) {
        return flattenFragment(itemsValue.map(itemFunc));
    }

    let cache = new WeakMap<T, Component[]>();
    const root = new Component(null, 'For');

    root.addValueWatcher(itemsValue, (items) => {
        root.replaceChildren(items.map(getItemFragment).flat());
    }, listsEqual);
    
    return root;

    function getItemFragment(item: T): Component[] {
        let fragment = cache.get(item);
        if (!fragment) {
            fragment = flattenFragment(itemFunc(item));
            cache.set(item, fragment);
        }
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

    addItem(title: string): void {
        this.items = [...this.items, {
            title,
            done: false,
            index: this.items.length,
        }];
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

const TestContext = new Context<string>('TestContext');

function TodoListView(model: TodoListModel) {
    const input = H('input');
    return H('div', null,
        H('button', {
            onclick() {
                console.log(dumpComponentTree(bodyComponent));
            }
        }, 'Print tree'),
        H('button', {
            onclick() {
                updateAll();
            }
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
                    .addMountHandler(function () {
                        console.log('mounted');
                        console.log('TestContext:', this.getContext(TestContext));
                    })
                    .addUnmountHandler(function () {
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
    console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(bodyComponent), 'components.');
}

const todoListModel = new TodoListModel();
todoListModel.addItem('Bake bread');

const bodyComponent = new Component(document.body).appendChildren([
    TodoListView(todoListModel),
    TestComponent(),
]).mount();
