import { calcLevenshteinOperations, WritableKeys, errorDescription } from './util';

// used as a private 'missing' placeholder that outside code can't create
const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

export const Loading: unique symbol = Symbol('Loading');
export type Loading = typeof Loading;

export type Value<T> = T | Promise<T> | ValueFunc<T>;
export type ValueFunc<T> = (newValue?: T) => ValueFuncResult<T>;
export type ValueFuncResult<T> = T | Promise<T> | Loading;

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

export function newProp<T>(initialValue?: ValueFuncResult<T>): ValueFunc<T> {
    let value = initialValue === undefined ? Loading : initialValue;
    return (newValue?: ValueFuncResult<T>) => {
        if (newValue !== undefined) {
            value = newValue;
        }
        return value;
    };
}



export type Primitive = null | undefined | string | number | boolean;

export function isPrimitive(value: unknown): value is Primitive {
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



export type FragmentItem = Value<Primitive> | Component | FragmentItem[];

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
    onmounted?: (this: Component<N>) => void;
    onunmount?: (this: Component<N>) => void;
    onupdate?: (this: Component<N>) => void | false;
};

export type Attributes<N extends Node | null> = PropertyAttributes<N> & EventAttributes<N> & ComponentAttributes<N>;

type RewriteThisParameter<F> =
    F extends (this: infer _, ...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret :
    F extends (...args: infer Args) => infer Ret ? (this: Component, ...args: Args) => Ret : never;


export class Context<T> {
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


export class Component<N extends Node | null = Node | null> {
    private parent?: Component;
    private firstChild?: Component;
    private lastChild?: Component;
    private nextSibling?: Component;
    private prevSibling?: Component;

    private detached?: boolean;
    private mounted?: boolean;
    private mountListeners?: (() => void)[];
    private mountedListeners?: (() => void)[];
    private unmountListeners?: (() => void)[];
    private updateListeners?: (() => void | false)[];

    private unhandledError?: unknown;
    private errorHandler?: ((error: unknown) => boolean);

    private suspenseCount?: number;
    private suspenseHandler?: (count: number) => void;

    private contextValues?: Map<Context<unknown>, unknown>;

    constructor(readonly node: N, private readonly name?: string) {}

    getName(): string { return this.name ?? this.node?.nodeName ?? 'Component'; }

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

    injectError(error: unknown): void {
        let c: Component = this;
        for (;;) {
            try {
                if (c.errorHandler?.(error) === true) {
                    return;
                }
            } catch (e) {
                console.error(`failed to handle error: ${errorDescription(error)}`);
                error = e;
            }
            if (!c.parent) {
                c.unhandledError = error;
                console.error(`unhandled error: ${errorDescription(error)}`);
                return;
            }
            c = c.parent;
        }
    }

    setErrorHandler(handler: (this: Component<N>, error: unknown) => boolean): Component<N> {
        this.errorHandler = handler.bind(this);
        const unhandled = this.unhandledError;
        if (unhandled) {
            this.unhandledError = undefined;
            this.injectError(unhandled);
        }
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

    addMountListener(listener: (this: Component<N>) => void): Component<N> {
        const boundListener = listener.bind(this);
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

    addMountedListener(listener: (this: Component<N>) => void): Component<N> {
        const boundListener = listener.bind(this);
        if (this.mountedListeners) {
            this.mountedListeners.push(boundListener);
        } else {
            this.mountedListeners = [boundListener];
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

    addUnmountListener(listener: (this: Component<N>) => void): Component<N> {
        const boundListener = listener.bind(this);
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

    setAttributes(attributes: Attributes<N>): Component<N> {
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
                case 'onmounted':
                    this.addMountedListener(value);
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

        let pendingMountedCalls: Component[] | undefined;
        if (this.mounted && !child.mounted) {
            pendingMountedCalls = child.doMount();
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
            // child component doesn't have a suspense handler and thus will spill its suspense count up to us.
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

        if (pendingMountedCalls) {
            this.signalMounted(pendingMountedCalls);
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
            // child component doesn't have a suspense handler and thus will have spilled its suspense count up to us, so we must subtract it.
            this.addSuspenseCount(-child.suspenseCount);
        }

        if (child.mounted) {
            child.unmount();
        }
        
        return this;
    }

    removeFromParent(): Component<N> {
        this.parent?.removeChild(this);
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

    forEachChild(handler: (child: Component) => void): Component<N> {
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

    mount(): Component<N> {
        const pendingMountedCalls = this.doMount();
        this.signalMounted(pendingMountedCalls);
        return this;
    }
    
    private signalMounted(components: Component[]): void {
        for (const component of components) {
            if (component.mountedListeners) {
                for (const listener of component.mountedListeners) {
                    try {
                        listener();
                    } catch (e) {
                        component.injectError(e);
                    }
                }
            }
        }
    }

    private doMount(): Component[] {
        const pendingMountedCalls: Component[] = [];
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
                        return []; // in case a mount handler caused the tree to be (synchronously) unmounted
                    }
                }
            }

            if (component.mountedListeners) {
                pendingMountedCalls.push(component);
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                stack.push(c);
            }
        }
        
        this.update(); // immediately update a mounted tree
        return pendingMountedCalls;
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

function componentTreeSize(component: Component): number {
    let count = 1;
    component.forEachChild(c => {
        count += componentTreeSize(c);
    });
    return count;
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



export function iterateFragment(fragment: FragmentItem, handler: (component: Component) => void, returnLastText = false): string {
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


export function flattenFragment(fragment: FragmentItem): Component[] {
    const components: Component[] = [];
    iterateFragment(fragment, components.push.bind(components));
    return components;
}


export function H<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Attributes<HTMLElementTagNameMap[K]> | null = null,
    ...children: FragmentItem[]
): Component<HTMLElementTagNameMap[K]>  {
    const component = new Component(document.createElement(tag))
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


export function StaticText(value: string): Component<Text> {
    return new Component(document.createTextNode(value));
}

export function DynamicText(value: Value<Primitive>): Component<Text> {
    const node = document.createTextNode('');
    return new Component(node).addValueWatcher(value, function onDynamicTextChanged(primitive) {
        node.nodeValue = primitive?.toString() ?? '';
    });
}


export function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> | Component[] {
    if (isStaticValue(value)) {
        return flattenFragment(mapper(value));
    }
    const component = new Component(null, name ?? 'With');
    component.addValueWatcher(value, function evalWith(v) {
        component.replaceChildren(flattenFragment(mapper(v)));
    });
    return component;
}

export function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> | Component[] {
    return With(condValue, function evalIf(cond) { return cond ? thenFragment : elseFragment; }, 'If');
}

export function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evalWhen(cond) { return cond ? bodyFragment : null; }, 'When');
}

export function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> | Component[] {
    return With(condValue, function evalUnless(cond) { return cond ? null : bodyFragment; }, 'Unless');
}

export function Match<T extends Primitive>(value: Value<T>, ...cases: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component<null> | Component[] {
    return With(value, function evalMatch(v: T) {
        for (const [matcher, ...fragment] of cases) {
            if (typeof matcher === 'function' ? matcher(v) : v === matcher) {
                return fragment;
            }
        }
        return null;
    }, 'Match');
}
export function Else<T>(_: T): true {
    return true;
}

export function For<T>(itemsValue: Value<T[]>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null> | Component[] {
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

export function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component<null> | Component[] {
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


export function ErrorBoundary(
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


export function Suspense(fallbackFragment: FragmentItem, ...bodyFragment: FragmentItem[]): Component<null> {
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


export function Lazy(body: (this: Component<null>) => FragmentItem | Promise<FragmentItem>): Component<null> {
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
