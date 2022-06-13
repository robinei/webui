import { calcLevenshteinOperations, toError, WritableKeys, errorDescription, asyncDelay } from './util';

type Primitive = null | undefined | string | number | boolean;

type DynamicValue<T> = Promise<T> | (() => T | Promise<T>);

type Value<T> = T | DynamicValue<T>;

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

type ComponentAttributes<N extends Node | null> = {
    onmount?: (this: Component<N>) => void;
    onunmount?: (this: Component<N>) => void;
    onupdate?: (this: Component<N>) => void | false;
};

type Attributes<N extends Node | null> = PropertyAttributes<N> & EventAttributes<N> & ComponentAttributes<N>;

type RewriteThisParameter<F> =
    F extends (this: infer _, ...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret :
    F extends (...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret : never;


export const NULL: unique symbol = Symbol();


class Component<N extends Node | null = Node | null> {
    readonly #node: N;
    readonly #name: string | undefined;
    #detached = false;

    #parent: Component | null = null;
    #firstChild: Component | null = null;
    #lastChild: Component | null = null;
    #nextSibling: Component | null = null;
    #prevSibling: Component | null = null;

    #mounted = false;
    #mountListeners: (() => void)[] | undefined;
    #unmountListeners: (() => void)[] | undefined;
    #updateListeners: (() => void | false)[] | undefined;
    #updateListenerCount = 0; // count for subtree

    #errorHandler: ((error: unknown) => boolean) | undefined;
    #unhandledError: unknown;

    #suspenseCount = 0;
    #suspenseHandler: ((count: number) => void) | undefined;

    get node(): N { return this.#node; }
    get name(): string { return this.#name ?? this.#node?.nodeName ?? 'anonymous'; }
    get isDetached(): boolean { return this.#detached; }

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
    }

    setErrorHandler(handler: (this: Component<N>, error: unknown) => boolean): Component<N> {
        this.#errorHandler = handler.bind(this);
        return this;
    }

    setSuspenseHandler(handler: (this: Component<N>, count: number) => void): Component<N> {
        this.#suspenseHandler = handler.bind(this);
        if (this.#suspenseCount && this.#parent) {
            // we don't contribute to parent count when we have a handler
            this.#parent.#addSuspenseCount(-this.#suspenseCount);
        }
        this.#suspenseHandler(this.#suspenseCount);
        return this;
    }

    async trackAsyncLoad(load: (this: Component<N>) => Promise<void>): Promise<void> {
        this.#addSuspenseCount(1);
        try {
            await load.bind(this)();
        } catch (e) {
            this.injectError(e);
        } finally {
            this.#addSuspenseCount(-1);
        }
    }

    addMountListener(listener: (this: Component<N>) => void): Component<N> {
        const boundListener = listener.bind(this);
        if (this.#mountListeners) {
            this.#mountListeners.push(boundListener);
        } else {
            this.#mountListeners = [boundListener];
        }
        if (this.#mounted) {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        }
        return this;
    }

    addUnmountListener(listener: (this: Component<N>) => void): Component<N> {
        if (this.#unmountListeners) {
            this.#unmountListeners.push(listener.bind(this));
        } else {
            this.#unmountListeners = [listener.bind(this)];
        }
        return this;
    }

    addUpdateListener(listener: (this: Component<N>) => void | false): Component<N> {
        if (this.#updateListeners) {
            this.#updateListeners.push(listener.bind(this));
        } else {
            this.#updateListeners = [listener.bind(this)];
        }
        this.#addUpdateListenerCount(1);
        return this;
    }

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => any): Component<N> {
        const self = this;
        if (!self.#node) {
            throw new Error('addEventListener called on node-less component');
        }
        const boundListener = listener.bind(self);
        self.#node.addEventListener(type, function listenerInvoker(ev: any): void {
            try {
                boundListener(ev);
            } catch (e) {
                self.injectError(e);
                return;
            }
            self.#updateRoot();
        });
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck: boolean = true): Component<N> {
        const self = this;
        const boundWatcher = watcher.bind(self);
        let lastEmittedValue: T;
        let hasEmittedValue = false;

        if (isConstValue(value)) {
            onValueChanged(value);
            return self;
        }
        
        if (value instanceof Promise) {
            self.trackAsyncLoad(async function performePromiseLoad() {
                const v = await value;
                onValueChanged(v);
            });
            return self;
        }

        const valueFunc = value;
        let lastVal: unknown = NULL;
        self.addUpdateListener(function checkIfValueChanged(): void {
            const newVal = valueFunc();
            if (equalCheck && newVal === lastVal) {
                return; // early check and return (do less in common case of no change)
            }
            if (!(newVal instanceof Promise)) {
                lastVal = newVal;
                onValueChanged(newVal);
                return;
            }
            if (newVal === lastVal) {
                return; // don't listen to same Promise (even if equalCheck is false)
            }
            lastVal = newVal;
            self.trackAsyncLoad(async function performePromiseLoad() {
                const v = await newVal;
                if (newVal === lastVal) {
                    onValueChanged(v);
                }
            });
        });

        function onValueChanged(v: T): void {
            try {
                if (!equalCheck || !hasEmittedValue || lastEmittedValue !== v) {
                    lastEmittedValue = v;
                    hasEmittedValue = true;
                    boundWatcher(v);
                }
            } catch (e) {
                self.injectError(e);
            }
        }

        return self;
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
                    this.addValueWatcher(styles[styleName]!, function onStyleChanged(primitive) {
                        elem.style[styleName] = primitive;
                    });
                }
            } else {
                if (!(this.#node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.#node;
                this.addValueWatcher(value, function onAttributeChanged(primitive) {
                    setElementAttribute(elem, name, primitive);
                });
            }
        }
        return this;
    }

    setDetached(detached: boolean): Component<N> {
        if (this.#detached !== detached) {
            this.#detached = detached;
            if (this.#parent) {
                const container = this.#parent.#getChildContainerNode();
                if (container) {
                    if (detached) {
                        this.#removeNodesFrom(container);
                    } else {
                        this.#insertNodesInto(container, this.#getInsertionAnchor());
                    }
                }
            }
        }
        return this;
    }

    insertBefore(child: Component, before: Component | null = null): Component<N> {
        if (child === this) {
            throw new Error('cannot attach component to itself');
        }
        if (child.#parent) {
            throw new Error('component is already attached to a component');
        }
        if (child.#mounted) {
            throw new Error('component already mounted');
        }

        if (before) {
            if (before.#parent !== this) {
                throw new Error('reference component not child of this component');
            }
            if (before.#prevSibling) {
                before.#prevSibling.#nextSibling = child;
            } else {
                this.#firstChild = child;
            }
            child.#prevSibling = before.#prevSibling;
            before.#prevSibling = child;
        } else {
            if (this.#lastChild) {
                this.#lastChild.#nextSibling = child;
            } else {
                this.#firstChild = child;
            }
            child.#prevSibling = this.#lastChild;
            this.#lastChild = child;
        }
        child.#nextSibling = before;
        child.#parent = this;

        if (child.#updateListenerCount) {
            this.#addUpdateListenerCount(child.#updateListenerCount);
        }
        
        const container = this.#getChildContainerNode();
        if (container) {
            child.#insertNodesInto(container, child.#getInsertionAnchor());
        }

        if (child.#suspenseCount && !child.#suspenseHandler) {
            // component doesn't contribute to our count when it has a handler.
            // use pre-mount count because if mount changed the count then that diff will already have been added here
            this.#addSuspenseCount(child.#suspenseCount);
        }

        if (this.#mounted) {
            child.mount();
        }

        if (child.#unhandledError !== undefined) {
            const e = child.#unhandledError;
            child.#unhandledError = undefined;
            this.injectError(e);
        }

        return this;
    }

    removeChild(child: Component): Component<N> {
        if (child.#parent !== this) {
            throw new Error('not child of this node');
        }

        if (child.#prevSibling) {
            child.#prevSibling.#nextSibling = child.#nextSibling;
        } else {
            this.#firstChild = child.#nextSibling;
        }
        if (child.#nextSibling) {
            child.#nextSibling.#prevSibling = child.#prevSibling;
        } else {
            this.#lastChild = child.#prevSibling;
        }
        child.#prevSibling = null;
        child.#nextSibling = null;
        child.#parent = null;

        if (child.#updateListenerCount) {
            this.#addUpdateListenerCount(-child.#updateListenerCount);
        }
        
        if (!this.#detached) {
            const container = this.#getChildContainerNode();
            if (container) {
                child.#removeNodesFrom(container);
            }
        }

        if (child.#suspenseCount && !child.#suspenseHandler) {
            // we don't contribute to parent count when we have a handler
            this.#addSuspenseCount(-child.#suspenseCount);
        }

        if (child.#mounted) {
            child.#unmount();
        }
        
        return this;
    }

    appendChild(child: Component): Component<N> {
        return this.insertBefore(child);
    }

    insertAfter(child: Component, reference: Component | null): Component<N> {
        return this.insertBefore(child, reference?.nextSibling ?? null);
    }

    replaceChild(replacement: Component, replaced: Component): Component<N> {
        if (replacement === replaced) {
            return this;
        }
        this.insertBefore(replacement, replaced);
        this.removeChild(replaced);
        return this;
    }

    appendFragment(fragment: FragmentItem): Component<N> {
        iterateFragment(fragment, this.appendChild.bind(this));
        return this;
    }

    appendChildren(children: Component[]): Component<N> {
        for (const child of children) {
            this.appendChild(child);
        }
        return this;
    }

    replaceChildren(children: Component[]): Component<N> {
        const operations = calcLevenshteinOperations(this.children, children);
        for (const op of operations) {
            switch (op.type) {
            case 'replace': this.replaceChild(op.newValue, op.oldValue); break;
            case 'insert': this.insertBefore(op.value, op.before); break;
            case 'remove': this.removeChild(op.value); break;
            }
        }
        return this;
    }

    get children(): Component[] {
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
            this.removeChild(child);
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
            root.#unhandledError = error;
            console.error(`unhandled error: ${errorDescription(error)}`);
        }
        root.#updateRoot();
    }

    mount(): Component<N> {
        this.#mount();
        this.update();
        return this;
    }

    update(): Component<N> {
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.#mounted) {
                break;
            }
            ++touchedComponents;
            if (component.#updateListeners) {
                let skipSubtree = false;
                for (const listener of component.#updateListeners) {
                    updaterCount += 1;
                    try {
                        if (listener() === false) {
                            skipSubtree = true;
                        }
                    } catch (e) {
                        component.injectError(e);
                    }
                }
                if (skipSubtree) {
                    continue;
                }
            }
            for (let c = component.#firstChild; c; c = c.#nextSibling) {
                if (c.#updateListenerCount > 0) {
                    stack.push(c);
                }
            }
        }
        return this;
    }

    #mount(): void {
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (component.#mounted) {
                break;
            }
            component.#mounted = true;
            if (component.#mountListeners) {
                for (const listener of component.#mountListeners) {
                    try {
                        listener();
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (!component.#mounted) {
                        return; // in case a mount handler caused the tree to be (synchronously) unmounted
                    }
                }
            }
            for (let c = component.#firstChild; c; c = c.#nextSibling) {
                stack.push(c);
            }
        }
    }

    #unmount(): void {
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.#mounted) {
                break;
            }
            component.#mounted = false;
            if (component.#unmountListeners) {
                for (const listener of component.#unmountListeners) {
                    try {
                        listener();
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (component.#mounted) {
                        return; // in case an unmount handler caused the tree to be (synchronously) mounted
                    }
                }
            }
            for (let c = component.#firstChild; c; c = c.#nextSibling) {
                stack.push(c);
            }
        }
    }

    #getChildContainerNode(): Node | null {
        if (this.#node) {
            return this.#node;
        }
        let p: Component | null = this.#parent;
        for (; p; p = p.#parent) {
            if (p.#node) {
                return p.#node;
            }
            if (p.#detached) {
                break;
            }
        }
        return null;
    }

    #getInsertionAnchor(): Node | null {
        return (this.#nextSibling ? this.#nextSibling.#getFirstNodeGoingForward() : this.#getLastNodeGoingBackward(false)?.nextSibling) ?? null;
    }

    #insertNodesInto(container: Node, beforeNode: Node | null): void {
        if (this.#detached) {
            return;
        }
        const node = this.#node;
        if (node) {
            if (!node.parentNode) {
                container.insertBefore(node, beforeNode);
            } else if (node.parentNode !== container) {
                throw new Error('unexpected parent node');
            }
            return;
        }
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            c.#insertNodesInto(container, beforeNode);
        }
    }

    #removeNodesFrom(container: Node): void {
        const node = this.#node;
        if (node) {
            if (node.parentNode) {
                if (node.parentNode !== container) {
                    throw new Error('unexpected parent node');
                }
                container.removeChild(node);
            }
            return;
        }
        for (let c = this.#firstChild; c; c = c.#nextSibling) {
            if (!c.#detached) {
                c.#removeNodesFrom(container);
            }
        }
    }

    #getFirstNode(): Node | null {
        if (this.#detached) {
            return null;
        }
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
        if (this.#detached) {
            return null;
        }
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

    #addSuspenseCount(diff: number): void {
        for (let c: Component | null = this; c; c = c.#parent) {
            c.#suspenseCount += diff;
            if (c.#suspenseHandler) {
                try {
                    c.#suspenseHandler(c.#suspenseCount);
                } catch (e) {
                    c.injectError(e);
                }
                break;
            }
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

let updaterCount = 0;
let touchedComponents = 0;





function isConstValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function' && !(value instanceof Promise);
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
        } else if (!component.firstChild && component.node?.textContent) {
            result.push(' (textContent = ');
            result.push(JSON.stringify(component.node.textContent));
            result.push(')');
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


function iterateFragment(fragment: FragmentItem, handler: (component: Component) => void, returnLastText = false): string {
    let lastText = '';
    next(fragment);
    if (lastText && !returnLastText) {
        handler(StaticText(lastText));
        lastText = '';
    }
    return lastText;

    function next(fragment: FragmentItem): void {
        if (fragment === null || fragment === undefined) {
            // ignore
        } else if (fragment instanceof Component) {
            if (lastText) {
                handler(StaticText(lastText));
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
                    handler(StaticText(lastText));
                    lastText = '';
                }
                handler(DynamicText(fragment));
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
    const component = new Component(document.createElement(tag)).setAttributes(attributes);
    const lastText = iterateFragment(children, component.appendChild.bind(component), true);
    if (lastText) {
        if (component.firstChild) {
            component.appendChild(StaticText(lastText));
        } else {
            // can only set textContent if there were no other children
            component.node.textContent = lastText;
        }
    }
    return component;
}


function StaticText(value: string): Component<Text> {
    return new Component(document.createTextNode(value));
}


function DynamicText(value: Value<Primitive>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node).addValueWatcher(value, function onTextChanged(primitive) {
        node.nodeValue = primitive?.toString() ?? '';
    });
}


function With<T>(value: T, mapper: (v: T) => FragmentItem, name?: string): Component[];
function With<T>(value: DynamicValue<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null>;
function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> | Component[];
function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> | Component[] {
    if (isConstValue(value)) {
        return flattenFragment(mapper(value));
    }
    const component = new Component(null, name ?? 'With');
    component.addValueWatcher(value, function evalWith(v) {
        component.replaceChildren(flattenFragment(mapper(v)));
    });
    return component;
}
const foo = With(1, (_) => 'foo');

function If(condValue: boolean, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component[];
function If(condValue: DynamicValue<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null>;
function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> | Component[];
function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> | Component[] {
    return With(condValue, function evalIf(cond) { return cond ? thenFragment : elseFragment; }, 'If');
}

function When(condValue: boolean, ...bodyFragment: FragmentItem[]): Component[];
function When(condValue: DynamicValue<boolean>, ...bodyFragment: FragmentItem[]): Component<null>;
function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[];
function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evelWhen(cond) { return cond ? bodyFragment : null; }, 'When');
}

function Unless(condValue: boolean, ...bodyFragment: FragmentItem[]): Component[];
function Unless(condValue: DynamicValue<boolean>, ...bodyFragment: FragmentItem[]): Component<null>;
function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[];
function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evalUnless(cond) { return cond ? null : bodyFragment; }, 'Unless');
}


function Match<T extends Primitive>(value: T, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component[];
function Match<T extends Primitive>(value: DynamicValue<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component<null>;
function Match<T extends Primitive>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component<null> | Component[];
function Match<T extends Primitive>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component<null> | Component[] {
    return With(value, function evalMatch(v: T) {
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


function For<T>(itemsValue: T[], renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component[];
function For<T>(itemsValue: DynamicValue<T[]>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null>;
function For<T>(itemsValue: Value<T[]>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null> | Component[];
function For<T>(itemsValue: Value<T[]>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null> | Component[] {
    if (isConstValue(itemsValue)) {
        return flattenFragment(itemsValue.map(renderFunc));
    }

    const keyOf = keyFunc ?? ((item) => item);
    let map = new Map<unknown, Component[]>();

    const component = new Component(null, 'For');
    component.addValueWatcher(itemsValue, function checkItems(items) {
        if (areChildrenEqual(items)) {
            return;
        }
        const newMap = new Map();
        const children: Component[] = [];
        for (const item of items) {
            const key = keyOf(item);
            const fragment = map.get(key) ?? flattenFragment(renderFunc(item));
            newMap.set(key, fragment);
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
            let fragment = map.get(keyOf(item));
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


function Repeat(countValue: number, itemFunc: (i: number) => FragmentItem): Component[];
function Repeat(countValue: DynamicValue<number>, itemFunc: (i: number) => FragmentItem): Component<null>;
function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component<null> | Component[];
function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component<null> | Component[] {
    if (isConstValue(countValue)) {
        const fragment: FragmentItem[] = [];
        for (let i = 0; i < countValue; ++i) {
            fragment.push(itemFunc(i));
        }
        return flattenFragment(fragment);
    }
    
    let fragmentSizes: number[] = [];
    const component = new Component(null, 'Repeat');
    component.addValueWatcher(countValue, function onCountChanged(count) {
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


function ErrorBoundary(fallback: (error: Error, reset: () => void) => FragmentItem, body: () => FragmentItem): Component<null> {
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


function Suspense(fallbackFragment: FragmentItem, ...bodyFragment: FragmentItem[]): Component<null> {
    const fallback = new Component(null, 'SuspenseFallback').appendFragment(fallbackFragment);
    const body = new Component(null, 'SuspenseBody').appendFragment(bodyFragment);
    const component = new Component(null, 'Suspense');
    component.appendChild(body);
    body.setSuspenseHandler((count) => {
        if (count > 0) {
            if (!body.isDetached) {
                body.setDetached(true);
                component.appendChild(fallback);
            }
        } else {
            if (body.isDetached) {
                component.removeChild(fallback);
                body.setDetached(false);
            }
        }
    });
    return component;
}


function Lazy(bodyThunk: () => FragmentItem | Promise<FragmentItem>): Component<null> {
    const component = new Component(null, 'Lazy');
    let loaded = false;
    component.addMountListener(() => {
        if (loaded) {
            return;
        }
        loaded = true;
        const bodyResult = bodyThunk();
        if (!(bodyResult instanceof Promise)) {
            component.appendFragment(bodyResult);
            return;
        }
        component.trackAsyncLoad(async function loadLazyBody() {
            const loadedBody = await bodyResult;
            component.appendFragment(loadedBody);
        });
    });
    return component;
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
            [1, StaticText('odd')
                    .addMountListener(() => console.log('mounted'))
                    .addUnmountListener(() => console.log('unmounted'))]),
        For(model.getItems, TodoItemView),
    );
}




function TestComponent() {
    return ErrorBoundary(ErrorFallback, () => {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        const asyncTrue = asyncDelay(500).then(() => true);

        let width = 15;
        let height = 10;

        return Suspense('Loading...', When(asyncTrue,
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

            Lazy(async () => {
                await asyncDelay(500);
                return ['Loaded 1', H('br')];
            }),
            Lazy(() => {
                return ['Loaded 2', H('br')];
            }),
            
            'Width: ', Slider(width, 1, 20, (w) => { width = w; }), H('br'),
            'Height: ', Slider(height, 1, 20, (h) => { height = h; }), H('br'),
            H('table', null,
                Repeat(() => height, (y) =>
                    H('tr', null,
                        Repeat(() => width, (x) =>
                            H('td', null, [((x+1)*(y+1)).toString(), ' | ']))))),
        ));

        function Slider(initialValue: number, min: number, max: number, callback: (v: number) => void) {
            return H('input', {
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: initialValue.toString(),
                oninput(ev: Event) {
                    callback((ev.target as any).value);
                }
            });
        }

        function CheckBox() {
            const cb = H('input', { type: 'checkbox', onchange: () => { /* empty handler still triggers update */ } });
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
