import { ThinVec, tvPush, tvForEach, tvEmpty, calcLevenshteinOperations, toError, WritableKeys, errorDescription, asyncDelay, tvRemove } from './util';

type Primitive = null | undefined | string | number | boolean;

type Value<T> = T | Promise<T> | (() => T | Promise<T>) | Slot<T>;

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


type ErrorHandler = (this: Component, error: unknown) => boolean;

export const NULL: unique symbol = Symbol();


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

    #errorHandler: ((error: unknown) => boolean) | undefined;

    get node(): N { return this.#node; }
    get name(): string { return this.#name ?? this.#node?.nodeName ?? 'anonymous'; }

    get parent(): Component | null { return this.#parent; }
    get firstChild(): Component | null { return this.#firstChild; }
    get lastChild(): Component | null { return this.#lastChild; }
    get nextSibling(): Component | null { return this.#nextSibling; }
    get prevSibling(): Component | null { return this.#prevSibling; }

    get root(): Component {
        let c: Component = this;
        while (c.parent) { c = c.parent; }
        return c;
    }

    constructor(node: N, name?: string) {
        this.#node = node;
        this.#name = name;
        this.#container = node;
    }

    setErrorHandler(handler: ErrorHandler): Component<N> {
        this.#errorHandler = handler.bind(this);
        return this;
    }

    addMountListener(listener: MountListener): Component<N> {
        const boundListener = listener.bind(this);
        const wrappedListener = () => {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        };
        this.#mountListeners = tvPush(this.#mountListeners, wrappedListener);
        if (this.#mounted) {
            wrappedListener();
        }
        return this;
    }

    addUnmountListener(listener: UnmountListener): Component<N> {
        const boundListener = listener.bind(this);
        this.#unmountListeners = tvPush(this.#unmountListeners, () => {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        });
        return this;
    }

    addUpdateListener(listener: UpdateListener): Component<N> {
        const boundListener = listener.bind(this);
        this.#updateListeners = tvPush(this.#updateListeners, () => {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        });
        this.#addUpdateListenerCount(1);
        return this;
    }

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => any): Component<N> {
        if (!this.#node) {
            throw new Error('addEventListener called on node-less component');
        }
        const boundListener = listener.bind(this);
        this.#node.addEventListener(type, (ev: any) => {
            try {
                boundListener(ev);
            } catch (e) {
                this.injectError(e);
                return;
            }
            this.#updateRoot();
        });
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck: boolean = true): Component<N> {
        const boundWatcher = watcher.bind(this);
        let lastEmittedValue: T;
        let hasEmittedValue = false;
        const wrappedWatcher = (v: T) => {
            try {
                if (!equalCheck || !hasEmittedValue || lastEmittedValue !== v) {
                    lastEmittedValue = v;
                    hasEmittedValue = true;
                    boundWatcher(v);
                }
            } catch (e) {
                this.injectError(e);
            }
        };

        if (isConstValue(value)) {
            wrappedWatcher(value);
            return this;
        }
        
        if (value instanceof Promise) {
            value.then((v) => {
                wrappedWatcher(v);
            }, (e) => {
                this.injectError(e);
            });
            return this;
        }

        if (value instanceof Slot) {
            this.addMountListener(() => {
                value.addChangeListener(boundWatcher);
                boundWatcher(value.get());
            });
            this.addUnmountListener(() => {
                value.removeChangeListener(boundWatcher);
            });
            return this;
        }

        let lastVal: unknown = NULL;
        this.addUpdateListener(() => {
            const newVal = value();
            if (equalCheck && newVal === lastVal) {
                return; // early check and return (do less in common case of no change)
            }
            if (!(newVal instanceof Promise)) {
                lastVal = newVal;
                wrappedWatcher(newVal);
                return;
            }
            if (newVal === lastVal) {
                return; // don't listen to same Promise (even if equalCheck is false)
            }
            lastVal = newVal;
            newVal.then((v) => {
                if (newVal === lastVal) {
                    wrappedWatcher(v);
                }
            }, (e) => {
                if (newVal === lastVal) {
                    this.injectError(e);
                }
            });
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

    injectError(error: unknown): void {
        const root = this.root;
        let handled = false;
        for (let c: Component | null = this; c; c = c.#parent) {
            try {
                if (c.#errorHandler?.(error) === true) {
                    handled = true;
                    break;
                }
            } catch (e) {
                console.error(`failed to handle error: ${errorDescription(error)}`);
                error = e;
            }
        }
        if (!handled) {
            console.error(`unhandled error: ${errorDescription(error)}`);
        }
        root.#updateRoot();
    }

    #mount(): void {
        if (this.#mounted) {
            throw new Error('already mounted');
        }
        tvForEach(this.#mountListeners, (listener) => {
            listener();
        });
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#mount();
        }
        this.#mounted = true;
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
    
    #updateRoot(): void {
        if (!this.#mounted) {
            return;
        }
        const t0 = performance.now();
        updaterCount = 0;
        touchedComponents = 0;
        const root = this.root;
        root.update();
        const t1 = performance.now();
        console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(root), 'components. Time:', (t1 - t0).toFixed(2), 'ms');
    }
}


class Slot<T> {
    #value: T;
    #listeners: ThinVec<(value: T) => void> = tvEmpty;

    constructor(initialValue: T) {
        this.#value = initialValue;
    }

    addChangeListener(listener: (value: T) => void): void {
        this.#listeners = tvPush(this.#listeners, listener);
    }

    removeChangeListener(listener: (value: T) => void): void {
        this.#listeners = tvRemove(this.#listeners, listener);
    }

    set(value: T): void {
        if (this.#value !== value) {
            this.#value = value;
            tvForEach(this.#listeners, (listener) => listener(value));
        }
    }

    get = (): T => {
        return this.#value;
    };
}



let updaterCount = 0;
let touchedComponents = 0;


function isConstValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function' && !(value instanceof Promise) && !(value instanceof Slot);
}

function isPrimitive(value: unknown): value is Primitive {
    if (value === null) {
        return true;
    }
    switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
        return true;
    }
    return false;
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
        for (let i = 0; i < depth; ++i) {
            result.push('  ');
        }
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
    let lastText = '';
    next(fragment);
    if (lastText) {
        handler(StaticTxt(lastText));
    }

    function next(fragment: FragmentItem): void {
        if (fragment === null || fragment === undefined) {
            // ignore
        } else if (fragment instanceof Component) {
            if (lastText) {
                handler(StaticTxt(lastText));
                lastText = '';
            }
            handler(fragment);
        } else if (Array.isArray(fragment)) {
            for (const item of fragment) {
                next(item);
            }
        } else {
            if (isConstValue(fragment)) {
                lastText += fragment?.toString() ?? '';
            } else {
                if (lastText) {
                    handler(StaticTxt(lastText));
                    lastText = '';
                }
                handler(Txt(fragment));
            }
        }
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


function StaticTxt(value: string): Component<Text> {
    return new Component(document.createTextNode(value));
}


function Txt(value: Value<Primitive>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node).addValueWatcher(value, (primitive) => {
        node.nodeValue = primitive?.toString() ?? '';
    });
}


function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component | Component[] {
    if (isConstValue(value)) {
        return flattenFragment(mapper(value));
    }
    const component = new Component(null, name ?? 'With');
    component.addValueWatcher(value, (v) => {
        component.replaceChildren(flattenFragment(mapper(v)));
    });
    return component;
}


function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component | Component[] {
    return With(condValue, (cond) => cond ? thenFragment : elseFragment, 'If');
}
function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component | Component[] {
    return With(condValue, (cond) => cond ? bodyFragment : null, 'When');
}
function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component | Component[] {
    return With(condValue, (cond) => cond ? null : bodyFragment, 'Unless');
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
    const component = new Component(null, 'For');

    component.addValueWatcher(itemsValue, (items) => {
        if (areChildrenEqual(items)) {
            return;
        }
        const newMap = new Map();
        const children: Component[] = [];
        for (const item of items) {
            const fragment = map.get(item) ?? flattenFragment(itemFunc(item));
            newMap.set(item, fragment);
            for (const child of fragment) {
                children.push(child);
            }
        }
        component.replaceChildren(children);
        map = newMap;
    }, false);
    
    return component;

    function areChildrenEqual(items: T[]): boolean {
        let c = component.firstChild;
        for (const item of items) {
            let fragment = map.get(item);
            if (!fragment) {
                return false;
            }
            for (const child of fragment) {
                if (child !== c) {
                    return false;
                }
                c = c.nextSibling;
            }
        }
        return c === null;
    }
}


function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component | Component[] {
    if (isConstValue(countValue)) {
        const fragment: FragmentItem[] = [];
        for (let i = 0; i < countValue; ++i) {
            fragment.push(itemFunc(i));
        }
        return flattenFragment(fragment);
    }
    
    let fragmentSizes: number[] = [];
    const component = new Component(null, 'Repeat');
    component.addValueWatcher(countValue, (count) => {
        while (fragmentSizes.length > count && fragmentSizes.length > 0) {
            const fragmentSize = fragmentSizes.pop()!;
            for (let i = 0; i < fragmentSize; ++i) {
                component.removeChild(component.lastChild!);
            }
        }
        while (fragmentSizes.length < count) {
            const fragment = flattenFragment(itemFunc(fragmentSizes.length));
            fragmentSizes.push(fragment.length);
            component.appendChildren(fragment);
        }

    });
    return component;
}


function ErrorBoundary(fallback: (error: Error, reset: () => void) => FragmentItem, body: () => FragmentItem): Component {
    const component = new Component(null, 'ErrorBoundary').setErrorHandler(onError);
    initContent();
    return component;

    function onError(error: unknown): boolean {
        const fragment = flattenFragment(fallback(toError(error), initContent));
        component.clear();
        component.appendChildren(fragment);
        console.error(`Error caught by ErrorBoundary: ${errorDescription(error)}`);
        return true;
    }

    function initContent(): void {
        try {
            const fragment = flattenFragment(body());
            component.clear();
            component.appendChildren(fragment);
        } catch (e) {
            component.injectError(e);
        }
    }
}






interface TodoItemModel {
    title: string;
    done: boolean;
    index: number;
}

class TodoListModel {
    private readonly items: TodoItemModel[] = [];

    addItem(title: string) {
        this.items.push({
            title,
            done: false,
            index: this.items.length,
        });
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
    return ErrorBoundary(ErrorFallback, () => {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        const asyncValue = asyncDelay(1000).then(() => {
            throw new Error('async error');
        });
        const asyncTrue = asyncDelay(100).then(() => true);

        let width = new Slot(10);
        let height = new Slot(10);

        return When(() => asyncTrue,
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
            
            H('br'),
            H('button', { onclick() { throw new Error('test error'); } }, 'Fail'), H('br'),
            
            'Width: ',
            H('input', { type: 'range', min: '1', max: '20', value: width.toString(), oninput(ev: Event) {
                width.set((ev.target as any).value);
            } }),
            H('br'),
            'Height: ',
            H('input', { type: 'range', min: '1', max: '20', value: height.toString(), oninput(ev: Event) {
                height.set((ev.target as any).value);
            } }),
            H('br'),
            H('table', null,
                Repeat(height, (y) =>
                    H('tr', null,
                        Repeat(width, (x) =>
                            H('td', null, [((x+1)*(y+1)).toString(), ' | ']))))),
            
            //Suspense(() => "Loading...", () => asyncValue),
        );

        function CheckBox() {
            const cb = H('input', { type: 'checkbox', onchange: () => {} });
            return [cb, () => cb.node.checked] as const;
        }
    });
}

function ErrorFallback(error: Error, reset: () => void): FragmentItem {
    return [
        H('pre', null, errorDescription(error)),
        H('button', { onclick: reset }, 'Reset')
    ];
}



new Component(document.body).appendChildren([
    TodoListView(new TodoListModel().addItem('Bake bread')),
    TestComponent(),
]).mount();
