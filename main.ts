import { calcLevenshteinOperations, WritableKeys, errorDescription, asyncDelay } from './util';

// used as a private 'missing' placeholder that outside code can't create
const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

export const Loading: unique symbol = Symbol('Loading');
export type Loading = typeof Loading;

export type Value<T> = T | Promise<T> | ValueFunc<T>;
export type ValueFunc<T> = (newValue?: T) => ValueFuncResult<T>;
type ValueFuncResult<T> = T | Promise<T> | Loading;

export function isStaticValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function' && !(value instanceof Promise);
}

export function mapValue<T, R>(value: Value<T>, mapper: (v: T) => R): Value<R> {
    if (isStaticValue(value)) {
        return mapper(value);
    }
    if (value instanceof Promise) {
        return value.then(mapper);
    }
    let lastInput: ValueFuncResult<T> | Nil = Nil;
    let lastOutput: ValueFuncResult<R>;
    return function valueMapper() {
        const v = value();
        if (v === lastInput) {
            return lastOutput;
        }
        lastInput = v;
        if (v === Loading) {
            lastOutput = Loading;
        } else if (v instanceof Promise) {
            lastOutput = v.then(mapper);
        } else {
            lastOutput = mapper(v);
        }
        return lastOutput;
    };
}

function newProp<T>(initialValue?: ValueFuncResult<T>): ValueFunc<T> {
    let value = initialValue === undefined ? Loading : initialValue;
    return (newValue?: ValueFuncResult<T>) => {
        if (newValue !== undefined) {
            value = newValue;
        }
        return value;
    };
}



type Primitive = null | undefined | string | number | boolean;

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


class Context<T> {
    constructor(readonly name: string) {}

    Consume(bodyFunc: (value: T) => FragmentItem): Component<null> {
        const self = this;
        const component = new Component(null, this.name + '.Consume');
        let lastValue: T | Nil = Nil;
        component.addUpdateListener(function updateContextConsumer() {
            const value = component.getContext(self);
            if (value === lastValue) {
                return;
            }
            lastValue = value;
            const body = flattenFragment(bodyFunc(value));
            component.clear();
            component.appendChildren(body);
        });
        return component;
    }
}


class Component<N extends Node | null = Node | null> {
    private parent?: Component;
    private firstChild?: Component;
    private lastChild?: Component;
    private nextSibling?: Component;
    private prevSibling?: Component;

    private detached?: boolean;
    private mounted?: boolean;
    private mountListeners?: (() => void)[];
    private unmountListeners?: (() => void)[];
    private updateListeners?: (() => void | false)[];

    private errorHandler?: ((error: unknown) => boolean);
    private unhandledError?: unknown;

    private suspenseCount?: number;
    private suspenseHandler?: (count: number) => void;

    private contextValues?: Map<Context<unknown>, unknown>;

    // override this for components where content should be placed deeper
    /*setContent: (fragment: FragmentItem) => void = fragment => {
        this.clear();
        this.appendFragment(fragment);
    };*/

    constructor(readonly node: N, private readonly name?: string) {}

    getName(): string { return this.name ?? this.node?.nodeName ?? '#anon'; }

    getParent(): Component | undefined { return this.parent; }
    getFirstChild(): Component | undefined { return this.firstChild; }
    getLastChild(): Component | undefined { return this.lastChild; }
    getNextSibling(): Component | undefined { return this.nextSibling; }
    getPrevSibling(): Component | undefined { return this.prevSibling; }

    hasChildren(): boolean { return !!this.firstChild; }

    isDetached(): boolean { return this.detached ?? false; }

    getRoot(): Component {
        let c: Component = this;
        while (c.parent) { c = c.parent; }
        return c;
    }

    setErrorHandler(handler: (this: Component<N>, error: unknown) => boolean): Component<N> {
        this.errorHandler = handler.bind(this);
        return this;
    }

    setSuspenseHandler(handler: (this: Component<N>, count: number) => void): Component<N> {
        if (this.suspenseCount && this.parent && !this.suspenseHandler) {
            // we don't contribute to parent count when we have a handler
            this.parent.addSuspenseCount(-this.suspenseCount);
        }
        const boundHandler = this.suspenseHandler = handler.bind(this);
        boundHandler(this.suspenseCount ?? 0); // always invoke (even with 0), so the handler can ensure things start out according to the current count
        return this;
    }
    
    provideContext<T>(context: Context<T>, value: T): Component<N> {
        if (!this.contextValues) {
            this.contextValues = new Map();
        }
        this.contextValues.set(context, value);
        return this;
    }

    getContext<T>(context: Context<T>): T {
        for (let c: Component | undefined = this; c; c = c.parent) {
            if (c.contextValues) {
                const value = c.contextValues.get(context);
                if (value !== undefined) {
                    return value as T;
                }
            }
        }
        throw new Error('context not provided: ' + context.name);
    }

    async trackAsyncLoad(load: (this: Component<N>) => Promise<void>): Promise<void> {
        this.addSuspenseCount(1);
        try {
            await load.bind(this)();
        } catch (e) {
            this.injectError(e);
        } finally {
            this.addSuspenseCount(-1);
        }
    }

    private maybeWrapAsync(func: () => void | Promise<void>): (() => void) {
        const self = this;
        return function asyncErrorHandler() {
            const result = func();
            if (result instanceof Promise) {
                result.catch(e =>  self.injectError(e));
            }
        };
    }

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => any): Component<N> {
        const self = this;
        if (!self.node) {
            throw new Error('addEventListener called on node-less component');
        }
        const boundListener = listener.bind(self);
        self.node.addEventListener(type, function listenerInvoker(ev: any): void {
            try {
                boundListener(ev);
            } catch (e) {
                self.injectError(e);
                return;
            }
            self.updateRoot();
        });
        return this;
    }

    addMountListener(listener: (this: Component<N>) => void | Promise<void>): Component<N> {
        const boundListener = this.maybeWrapAsync(listener.bind(this));
        if (this.mountListeners) {
            this.mountListeners.push(boundListener);
        } else {
            this.mountListeners = [boundListener];
        }
        if (this.mounted) {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        }
        return this;
    }

    addUnmountListener(listener: (this: Component<N>) => void | Promise<void>): Component<N> {
        const boundListener = this.maybeWrapAsync(listener.bind(this));
        if (this.unmountListeners) {
            this.unmountListeners.push(boundListener);
        } else {
            this.unmountListeners = [boundListener];
        }
        return this;
    }

    addUpdateListener(listener: (this: Component<N>) => void | false): Component<N> {
        if (this.updateListeners) {
            this.updateListeners.push(listener.bind(this));
        } else {
            this.updateListeners = [listener.bind(this)];
        }
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck: boolean = true): Component<N> {
        const self = this;
        const boundWatcher = watcher.bind(self);
        let lastEmittedValue: T | Nil = Nil;

        if (isStaticValue(value)) {
            onValueChanged(value);
            return self;
        }
        
        if (value instanceof Promise) {
            self.trackAsyncLoad(async function awaitPromiseLoad() {
                const v = await value;
                onValueChanged(v);
            });
            return self;
        }

        const valueFunc = value;
        let lastVal: ValueFuncResult<T> | Nil = Nil;
        self.addUpdateListener(function checkIfValueChanged(): void {
            const newVal = valueFunc();
            if (equalCheck && newVal === lastVal) {
                return; // early check and return (do less in common case of no change)
            }
            if (!(newVal instanceof Promise)) {
                if (newVal === Loading) {
                    if (lastVal !== Loading) {
                        self.addSuspenseCount(1);
                        lastVal = newVal;
                    }
                    return;
                }
                if (lastVal === Loading) {
                    self.addSuspenseCount(-1);
                }
                lastVal = newVal;
                onValueChanged(newVal);
                return;
            }
            if (newVal === lastVal) {
                return; // don't listen to same Promise (even if equalCheck is false)
            }
            lastVal = newVal;
            self.trackAsyncLoad(async function awaitPromiseLoad() {
                const v = await newVal;
                if (newVal === lastVal) {
                    onValueChanged(v);
                }
            });
        });

        function onValueChanged(v: T): void {
            try {
                if (!equalCheck || lastEmittedValue !== v) {
                    lastEmittedValue = v;
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
            const value = (attributes as any)[name];

            if (typeof value === 'function' && name.startsWith('on')) {
                switch (name) {
                case 'onupdate':
                    this.addUpdateListener(value);
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
                if (!(this.node instanceof HTMLElement)) {
                    throw new Error('style attribute requires node to be HTMLElement');
                }
                const elem = this.node;
                const styles = value as Styles;
                for (const styleName in styles) {
                    this.addValueWatcher(styles[styleName]!, function onStyleChanged(primitive) {
                        elem.style[styleName] = primitive;
                    });
                }
            } else {
                if (!(this.node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.node;
                this.addValueWatcher(value, setElementAttribute.bind(null, elem, name));
            }
        }
        return this;
    }

    setDetached(detached: boolean): Component<N> {
        if (this.detached !== detached) {
            this.detached = detached;
            if (this.parent) {
                const container = this.parent.getChildContainerNode();
                if (container) {
                    if (detached) {
                        this.removeNodesFrom(container);
                    } else {
                        this.insertNodesInto(container, this.getInsertionAnchor());
                    }
                }
            }
        }
        return this;
    }

    insertBefore(child: Component, before?: Component): Component<N> {
        if (child === this) {
            throw new Error('cannot attach component to itself');
        }
        if (child.parent) {
            throw new Error('component is already attached to a component');
        }

        if (this.mounted && !child.mounted) {
            child.mount();
        }

        if (before) {
            if (before.parent !== this) {
                throw new Error('reference component not child of this component');
            }
            if (before.prevSibling) {
                before.prevSibling.nextSibling = child;
            } else {
                this.firstChild = child;
            }
            child.prevSibling = before.prevSibling;
            before.prevSibling = child;
        } else {
            if (this.lastChild) {
                this.lastChild.nextSibling = child;
            } else {
                this.firstChild = child;
            }
            child.prevSibling = this.lastChild;
            this.lastChild = child;
        }
        child.nextSibling = before;
        child.parent = this;

        if (child.suspenseCount && !child.suspenseHandler) {
            // component doesn't contribute to our count when it has a handler.
            // use pre-mount count because if mount changed the count then that diff will already have been added here
            this.addSuspenseCount(child.suspenseCount);
        }
        
        if (!child.detached) {
            let container = this.getChildContainerNode();
            if (container) {
                child.insertNodesInto(container, child.getInsertionAnchor());
            }
        }

        if (child.unhandledError !== undefined) {
            const e = child.unhandledError;
            child.unhandledError = undefined;
            this.injectError(e);
        }

        return this;
    }

    removeChild(child: Component): Component<N> {
        if (child.parent !== this) {
            throw new Error('not child of this node');
        }

        if (child.prevSibling) {
            child.prevSibling.nextSibling = child.nextSibling;
        } else {
            this.firstChild = child.nextSibling;
        }
        if (child.nextSibling) {
            child.nextSibling.prevSibling = child.prevSibling;
        } else {
            this.lastChild = child.prevSibling;
        }
        child.prevSibling = undefined;
        child.nextSibling = undefined;
        child.parent = undefined;
        
        if (!child.detached) {
            const container = this.getChildContainerNode();
            if (container) {
                child.removeNodesFrom(container);
            }
        }

        if (child.suspenseCount && !child.suspenseHandler) {
            // we don't contribute to parent count when we have a handler
            this.addSuspenseCount(-child.suspenseCount);
        }

        if (child.mounted) {
            child.unmount();
        }
        
        return this;
    }

    appendChild(child: Component): Component<N> {
        return this.insertBefore(child);
    }

    insertAfter(child: Component, reference: Component | undefined): Component<N> {
        return this.insertBefore(child, reference?.nextSibling);
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
        for (let c = this.firstChild; c; c = c.nextSibling) {
            children.push(c);
        }
        return children;
    }

    withChildren(handler: (child: Component) => void): Component<N> {
        for (let c = this.firstChild; c; c = c.nextSibling) {
            handler(c);
        }
        return this;
    }

    clear(): Component<N> {
        for (;;) {
            const child = this.firstChild;
            if (!child) {
                break;
            }
            this.removeChild(child);
        }
        return this;
    }

    injectError(error: unknown): void {
        const root = this.getRoot();
        let handled = false;
        for (let c: Component | undefined = this; c; c = c.parent) {
            try {
                if (c.errorHandler?.(error) === true) {
                    handled = true;
                    break;
                }
            } catch (e) {
                console.error(`failed to handle error: ${errorDescription(error)}`);
                error = e;
            }
        }
        if (!handled) {
            root.unhandledError = error;
            console.error(`unhandled error: ${errorDescription(error)}`);
        }
    }

    mount(): Component<N> {
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (component.mounted) {
                continue;
            }
            component.mounted = true;

            if (component.mountListeners) {
                for (const listener of component.mountListeners) {
                    try {
                        listener();
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (!component.mounted) {
                        return this; // in case a mount handler caused the tree to be (synchronously) unmounted
                    }
                }
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                stack.push(c);
            }
        }
        
        this.update(); // immediately update a mounted tree
        return this;
    }

    unmount(): Component<N> {
        if (this.parent) {
            throw new Error('can only explicitly unmount root components (not already inserted in a tree)');
        }
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.mounted) {
                continue;
            }
            component.mounted = false;

            if (component.unmountListeners) {
                for (const listener of component.unmountListeners) {
                    try {
                        listener();
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (component.mounted) {
                        return this; // in case an unmount handler caused the tree to be (synchronously) mounted
                    }
                }
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                stack.push(c);
            }
        }
        return this;
    }

    update(): Component<N> {
        const stack: Component[] = [this];
        for (;;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.mounted) {
                break;
            }
            ++touchedComponents;

            if (component.updateListeners) {
                let skipSubtree = false;
                for (const listener of component.updateListeners) {
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

            for (let c = component.lastChild; c; c = c.prevSibling) {
                if (c.updateListeners || c.firstChild) {
                    stack.push(c);
                }
            }
        }
        return this;
    }

    private getChildContainerNode(): Node | null {
        if (this.node) {
            return this.node;
        }
        for (let p = this.parent; p; p = p.parent) {
            if (p.node) {
                return p.node;
            }
            if (p.detached) {
                break;
            }
        }
        return null;
    }

    private getInsertionAnchor(): Node | null {
        return (this.nextSibling ? this.nextSibling.getFirstNodeGoingForward() : this.getLastNodeGoingBackward(false)?.nextSibling) ?? null;
    }

    private insertNodesInto(container: Node, beforeNode: Node | null): void {
        const node = this.node;
        if (node) {
            if (!node.parentNode) {
                container.insertBefore(node, beforeNode);
            } else {
                if (node.parentNode !== container) {
                    throw new Error('unexpected parentNode');
                }
                if (node.nextSibling !== beforeNode) {
                    throw new Error('unexpected nextSibling');
                }
            }
        } else {
            for (let c = this.firstChild; c; c = c.nextSibling) {
                if (!c.detached) {
                    c.insertNodesInto(container, beforeNode);
                }
            }
        }
    }

    private removeNodesFrom(container: Node): void {
        const node = this.node;
        if (node) {
            if (node.parentNode) {
                if (node.parentNode !== container) {
                    throw new Error('unexpected parent node');
                }
                container.removeChild(node);
            }
        } else {
            for (let c = this.firstChild; c; c = c.nextSibling) {
                if (!c.detached) {
                    c.removeNodesFrom(container);
                }
            }
        }
    }

    private getFirstNode(): Node | null {
        if (this.detached) {
            return null;
        }
        if (this.node) {
            return this.node;
        }
        for (let c = this.firstChild; c; c = c.nextSibling) {
            const node = c.getFirstNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    private getLastNode(): Node | null {
        if (this.detached) {
            return null;
        }
        if (this.node) {
            return this.node;
        }
        for (let c = this.lastChild; c; c = c.prevSibling) {
            const node = c.getLastNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    private getLastNodeGoingBackward(includeSelf: boolean = true): Node | null {
        for (let c: Component | undefined = includeSelf ? this : this.prevSibling; c; c = c.prevSibling) {
            const node = c.getLastNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.parent; parent && !parent.node; parent = parent.parent) {
            for (let c: Component | undefined = parent.prevSibling; c; c = c.prevSibling) {
                const node = c.getLastNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    private getFirstNodeGoingForward(includeSelf: boolean = true): Node | null {
        for (let c: Component | undefined = includeSelf ? this : this.nextSibling; c; c = c.nextSibling) {
            const node = c.getFirstNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.parent; parent && !parent.node; parent = parent.parent) {
            for (let c: Component | undefined = parent.nextSibling; c; c = c.nextSibling) {
                const node = c.getFirstNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    private addSuspenseCount(diff: number): void {
        for (let c: Component | undefined = this; c; c = c.parent) {
            c.suspenseCount = (c.suspenseCount ?? 0) + diff;
            if (c.suspenseHandler) {
                try {
                    c.suspenseHandler(c.suspenseCount);
                } catch (e) {
                    c.injectError(e);
                }
                break;
            }
        }
    }
    
    private updateRoot(): void {
        if (!this.mounted) {
            return;
        }
        const t0 = performance.now();
        updaterCount = 0;
        touchedComponents = 0;
        const root = this.getRoot();
        root.update();
        const t1 = performance.now();
        console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(root), 'components. Time:', (t1 - t0).toFixed(2), 'ms');
    }
}

let updaterCount = 0;
let touchedComponents = 0;




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
        result.push(component.getName());
        if (component.node instanceof Text) {
            result.push(': ');
            result.push(JSON.stringify(component.node.nodeValue));
        } else if (!component.hasChildren() && component.node?.textContent) {
            result.push(' (textContent = ');
            result.push(JSON.stringify(component.node.textContent));
            result.push(')');
        }
        result.push('\n');
        component.withChildren(c => recurse(c, depth + 1));
    }
}


function componentTreeSize(component: Component): number {
    let count = 1;
    component.withChildren(c => {
        count += componentTreeSize(c);
    });
    return count;
}


function iterateFragment(fragment: FragmentItem, handler: (component: Component) => void, returnLastText = false): string {
    let lastText = '';
    next(fragment);
    if (!returnLastText && lastText.length > 0) {
        handler(StaticText(lastText));
        return '';
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
            if (isStaticValue(fragment)) {
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
    const component = new Component(document.createElement(tag), tag)
    if (attributes) {
        component.setAttributes(attributes);
    }
    if (children.length > 0) {
        const lastText = iterateFragment(children, component.appendChild.bind(component), true);
        if (lastText) {
            if (component.hasChildren()) {
                component.appendChild(StaticText(lastText));
            } else {
                // can only set textContent if there were no other children
                component.node.textContent = lastText;
            }
        }
    }
    return component;
}


function StaticText(value: string): Component<Text> {
    return new Component(document.createTextNode(value), '#text');
}

function DynamicText(value: Value<Primitive>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node, '#text').addValueWatcher(value, function onDynamicTextChanged(primitive) {
        node.nodeValue = primitive?.toString() ?? '';
    });
}


function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> | Component[] {
    if (isStaticValue(value)) {
        return flattenFragment(mapper(value));
    }
    const component = new Component(null, name ?? 'With');
    component.addValueWatcher(value, function evalWith(v) {
        component.replaceChildren(flattenFragment(mapper(v)));
    });
    return component;
}

function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> | Component[] {
    return With(condValue, function evalIf(cond) { return cond ? thenFragment : elseFragment; }, 'If');
}

function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evalWhen(cond) { return cond ? bodyFragment : null; }, 'When');
}

function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evalUnless(cond) { return cond ? null : bodyFragment; }, 'Unless');
}

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

function For<T>(itemsValue: Value<T[]>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null> | Component[] {
    if (isStaticValue(itemsValue)) {
        return flattenFragment(itemsValue.map(renderFunc));
    }

    const keyOf = keyFunc ?? (item => item);
    let fragmentMap = new Map<unknown, Component[]>();

    const component = new Component(null, 'For');
    component.addValueWatcher(itemsValue, function checkItems(items) {
        if (areChildrenEqual(items)) {
            return;
        }
        const newFragmentMap = new Map();
        const children: Component[] = [];
        for (const item of items) {
            const key = keyOf(item);
            const fragment = fragmentMap.get(key) ?? flattenFragment(renderFunc(item));
            newFragmentMap.set(key, fragment);
            for (const child of fragment) {
                children.push(child);
            }
        }
        component.replaceChildren(children);
        fragmentMap = newFragmentMap;
    }, false);
    return component;

    function areChildrenEqual(items: T[]): boolean {
        let c = component.getFirstChild();
        for (const item of items) {
            let fragment = fragmentMap.get(keyOf(item));
            if (!fragment) {
                return false;
            }
            for (const child of fragment) {
                if (child !== c) {
                    return false;
                }
                c = c.getNextSibling();
            }
        }
        return c === null;
    }
}

function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component<null> | Component[] {
    if (isStaticValue(countValue)) {
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
                component.removeChild(component.getLastChild()!);
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


function ErrorBoundary(
    fallback: (this: Component<null>, error: unknown, reset: () => void) => FragmentItem,
    body: (this: Component<null>) => FragmentItem
): Component<null> {
    const component = new Component(null, 'ErrorBoundary').setErrorHandler(onError);
    const boundFallback = fallback.bind(component);
    const boundBody = body.bind(component);
    initContent();
    return component;

    function onError(error: unknown): boolean {
        console.error(`Error caught by ErrorBoundary: ${errorDescription(error)}`);
        try {
            const fragment = flattenFragment(boundFallback(error, initContent));
            component.clear();
            component.appendChildren(fragment);
        } catch (e) {
            const msg = `Error in ErrorBoundary fallback: ${(errorDescription(e))}`;
            console.error(msg);
            component.clear();
            component.appendChild(StaticText(msg));
        }
        return true;
    }

    function initContent(): void {
        try {
            const fragment = flattenFragment(boundBody());
            component.clear();
            component.appendChildren(fragment);
        } catch (e) {
            onError(e);
        }
    }
}


function Suspense(fallbackFragment: FragmentItem, ...bodyFragment: FragmentItem[]): Component<null> {
    const fallback = new Component(null, 'SuspenseFallback').appendFragment(fallbackFragment);
    const body = new Component(null, 'SuspenseBody').appendFragment(bodyFragment);
    const component = new Component(null, 'Suspense');
    component.appendChild(body);
    body.setSuspenseHandler(function suspenseHandler(count) {
        if (count > 0) {
            if (!body.isDetached()) {
                body.setDetached(true);
                component.appendChild(fallback);
            }
        } else {
            if (body.isDetached()) {
                component.removeChild(fallback);
                body.setDetached(false);
            }
        }
    });
    return component;
}


function Lazy(body: (this: Component<null>) => FragmentItem | Promise<FragmentItem>): Component<null> {
    const component = new Component(null, 'Lazy');
    const boundBody = body.bind(component);
    let loaded = false;
    component.addMountListener(function onMountLazy() {
        if (loaded) {
            return;
        }
        loaded = true;
        const bodyResult = boundBody();
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
    readonly #items: TodoItemModel[] = [];

    addItem(title: string) {
        this.#items.push({
            title,
            done: false,
            index: this.#items.length,
        });
        return this;
    }

    setAllDone = () => {
        for (const item of this.#items) {
            item.done = true;
        }
        return this;
    };

    setNoneDone = () => {
        for (const item of this.#items) {
            item.done = false;
        }
        return this;
    };

    items = () => {
        return this.#items;
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


function TodoItemView2(itemPromise: Promise<TodoItemModel>) {
    let item: TodoItemModel = {
        title: "Loading...",
        done: false,
        index: 0,
    };
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
    ).addMountListener(async function onMount() {
        item = await itemPromise;
    });
}

function TodoListView(model: TodoListModel) {
    const input = H('input');
    return H('div', null,
        H('button', {
            onclick() {
                console.log(dumpComponentTree(this.getRoot()));
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
        Match(() => model.items().length % 2,
            [0, 'even'],
            [1, StaticText('odd')
                    .addMountListener(() => console.log('mounted'))
                    .addUnmountListener(() => console.log('unmounted'))]),
        For(model.items, TodoItemView),
    );
}







const TestContext = new Context<string>('TestContext');


function TestComponent() {
    return ErrorBoundary(ErrorFallback, function tryTestComponent() {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        let width = newProp(15);
        let height = newProp<number>();
        let scale = newProp(1);
        asyncDelay(800).then(() => {
            height(10);
            this.update();
        });

        return Suspense('Loading...',
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
            TestContext.Consume(value => ['Context value: ', value]),
            H('br'),
            H('button', { onclick() { throw new Error('test error'); } }, 'Fail'), H('br'),

            Lazy(async () => {
                await asyncDelay(500);
                return ['Loaded 1', H('br')];
            }),
            Lazy(() => {
                return ['Loaded 2', H('br')];
            }),
            asyncDelay(500).then(() => 'Async text'), H('br'),
            
            'Width: ', Slider(width, 1, 20), H('br'),
            'Height: ', Slider(height, 1, 20), H('br'),
            'Scale: ', Slider(scale, 1, 10), H('br'),
            H('table', null,
                With(scale, s =>
                    Repeat(height, y =>
                        H('tr', null,
                            Repeat(width, x =>
                                H('td', null, [((x+1)*(y+1)*s).toString(), ' | '])))))),
        ).provideContext(TestContext, 'jalla');

        function Slider(value: Value<number>, min: number, max: number) {
            return H('input', {
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: mapValue(value, v => v.toString()),
                oninput(ev: Event) {
                    if (typeof value === 'function') {
                        value((ev.target as any).value);
                    }
                }
            });
        }

        function CheckBox() {
            const cb = H('input', { type: 'checkbox', onchange: () => { /* empty event handler still triggers update */ } });
            return [cb, () => cb.node.checked] as const;
        }
    });
}

function ErrorFallback(error: unknown, reset: () => void): FragmentItem {
    return [
        H('pre', null, errorDescription(error)),
        H('button', { onclick: reset }, 'Reset')
    ];
}








/*

type ParsePathSpec<P extends string> =
    P extends `${infer Prefix extends string}/${infer Rest extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpec<Rest>
        : ParsePathSpecSuffix<P>;

type ParsePathSpecSuffix<S extends string> =
    S extends `${infer Prefix extends string}?${infer Query extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpecQuery<Query>
        : ParsePathSpecTypedKey<S>;

type ParsePathSpecQuery<Q extends string> =
    Q extends `${infer Prefix extends string}&${infer Rest extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpecQuery<Rest>
        : ParsePathSpecTypedKey<Q>;

type ParsePathSpecTypedKey<S extends string> =
    S extends `${infer Key extends string}:${infer Type extends string}`
        ? { [_ in Key]: ParsePathSpecType<Type> }
        : {};

type ParsePathSpecType<S extends string> =
    S extends 'string' ? string :
    S extends 'number' ? number :
    S extends 'boolean' ? boolean : unknown;

type JoinPath<A extends string, B extends string> =
    A extends `${infer AP extends string}/`
        ? (B extends `/${infer BS extends string}` ? `${AP}/${BS}` : `${AP}/${B}`)
        : (B extends `/${infer BS extends string}` ? `${A}/${BS}` : `${A}/${B}`);

type FunctionsOf<T> = {
    [K in keyof T]: () => T[K];
};


type Test = FunctionsOf<ParsePathSpec<'/hello/foo:string/test/bar:number/asdf?arg:boolean&arg2:number'>>;
const test: Test = {} as any;







type PathMatcher = (path: string, args: { [key: string]: unknown }) => string;

function parsePathSpec(pathSpec: string): PathMatcher[] {
    if (pathSpec === '') {
        return [];
    }
    return pathSpec.split('/').map(part => {
        if (part === '') {
            return path => {
                if (path.startsWith('/')) {
                    return path.substring(1);
                }
                return path;
            };
        }

        if (part.indexOf(':') < 0) {
            const partSlash = part + '/';
            return path => {
                if (path === part) {
                    return '';
                }
                if (path.startsWith(partSlash)) {
                    return path.substring(partSlash.length);
                }
                return path;
            };
        }

        const [key, type] = part.split(':');
        if (!key || !type) {
            throw new Error('bad path spec');
        }
        let parser: (s: string) => unknown;
        switch (type) {
            case 'string': parser = s => s; break;
            case 'number': parser = s => {
                const num = Number(s);
                return isNaN(num) ? null : num;
            }; break;
            case 'boolean': parser = s => {
                switch (s.toLowerCase()) {
                    case '0':
                    case 'no':
                    case 'false': return false;
                    case '1':
                    case 'yes':
                    case 'true': return true;
                    default: return null;
                }
            }; break;
            default: throw new Error(`unknown type '${type}' in path spec`);
        }

        return (path, args) => {
            const i = path.indexOf('/');
            const prefix = path.substring(0, i < 0 ? path.length : i);
            const value = parser(prefix);
            if (value !== null) {
                args[key] = value;
                return path.substring(prefix.length);
            }
            return path;
        };
    });
}

class RouterNode<Args> {
    readonly #subnodes: RouterNode<any>[] = [];
    #component: Component | undefined;
    #matchers: PathMatcher[];
    #args: Args | undefined;

    constructor(readonly pathSpec: string, private readonly makeContent: (args: FunctionsOf<Args>) => FragmentItem) {
        this.#matchers = parsePathSpec(pathSpec);
    }

    route<PathSpec extends string>(
        pathSpec: PathSpec,
        makeContent: (args: FunctionsOf<ParsePathSpec<PathSpec> & Args>) => FragmentItem
    ): RouterNode<ParsePathSpec<PathSpec> & Args> {
        const r = new RouterNode(pathSpec, makeContent);
        this.#subnodes.push(r);
        return r;
    }

    goto(path: string): boolean {
        return this.handlePath(path, {});
    }

    private handlePath(path: string, prevArgs: { [key: string]: unknown }): boolean {
        const newArgs: { [key: string]: unknown } = { ...prevArgs };

        let rest = path;
        for (const matcher of this.#matchers) {
            const prev = rest;
            rest = matcher(rest, newArgs);
            if (Object.is(prev, rest)) {
                return false;
            }
        }
        this.#args = newArgs as any;

        for (const subnode of this.#subnodes) {
            if (subnode.handlePath(rest, newArgs)) {
                this.component.setContent(subnode.component);
                return true;
            }
        }

        return true;
    }

    get component(): Component {
        if (!this.#component) {
            const args = this.#args;
            if (!args) {
                throw new Error('args should have been parsed');
            }
            const argFuncs: FunctionsOf<Args> = {} as any;
            for (const key in args) {
                (argFuncs as any)[key] = () => args[key]!;
            }
            const components = flattenFragment(this.makeContent(argFuncs));
            if (components.length === 0) {
                this.#component = StaticText('');
            } else if (components.length === 1) {
                this.#component = components[0]!;
            } else {
                this.#component = new Component<null>(null, 'RouteGroup').appendChildren(components);
            }
        }
        return this.#component;
    }
}


function Router(element: HTMLElement): RouterNode<''> {
    return new RouterNode('', () => new Component(element, 'RouteRoot'));
}


const root = new RouterNode('', () => new Component<null>(null, 'RouteRoot'));

const prefs = root.route('prefs', _ => 'preferences');
const pref = prefs.route('name:string', args => ['viewing ', args.name]);
const editPref = pref.route('edit', args => ['editing ', args.name]);


root.goto('/prefs/foo')
*/

new Component(document.body).appendChildren([
    TodoListView(new TodoListModel().addItem('Bake bread')),
    TestComponent(),
    //root.component,
]).mount();


function benchmark(desc: string, iters: number, func: () => void): void {
    console.time(desc);
    try {
        for (let i = 0; i < iters; ++i) {
            func();
        }
    } finally {
        console.timeEnd(desc);
    }
}

const N = 10000;

benchmark("Component", N, () => {
    H('div', null,
        'foo',
        H('br'),
        H('div', null, 'bar'),
        'baz'
    );
});

benchmark("Vanilla", N, () => {
    const topDiv = document.createElement('div');
    topDiv.appendChild(document.createTextNode('foo'));
    topDiv.appendChild(document.createElement('br'));
    const innerDiv = document.createElement('div');
    innerDiv.textContent = 'bar';
    topDiv.appendChild(innerDiv);
    topDiv.appendChild(document.createTextNode('baz'));
});


document.write("Done");

/*
async function asyncTest() {
    async function* testGenerator(): AsyncGenerator<number, void, unknown> {
        try {
            for(let i = 0; ; ++i) {
                console.log("iter");
                await asyncDelay(1000);
                yield i;
            }
        } finally {
            console.log("finished");
        }
    }
    
    const gen = testGenerator();
    for (let i = 0; i < 5; ++i) {
        const x = await gen.next();
        if (!x.done) {
            console.log(x.value);
        }
    }
    console.log("BREAK");
    await asyncDelay(4000);
    console.log("BROKE");
    for (let i = 0; i < 5; ++i) {
        const x = await gen.next();
        if (!x.done) {
            console.log(x.value);
        }
    }
    gen.return();
}
asyncTest();
*/