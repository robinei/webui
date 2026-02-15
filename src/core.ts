import { longestIncreasingSubsequence, WritableKeys, errorDescription, isPlainObject } from './util';

const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;


export type Value<T> = T | (() => T);

export function isStaticValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function';
}

export function fields<T extends object>(source: () => T): { readonly [K in keyof T]: () => T[K] } {
    return new Proxy({} as any, {
        get(_, key: string | symbol) {
            return () => (source() as any)[key];
        }
    });
}

export function memoFilter<T>(source: Value<ReadonlyArray<T>>, predicate: (item: T) => boolean): () => T[] {
    const getItems = isStaticValue(source) ? () => source : source;
    let cached: T[] = [];
    return () => {
        const items = getItems();
        let ci = 0;
        for (let i = 0; i < items.length; ++i) {
            if (!predicate(items[i])) continue;
            if (ci >= cached.length || cached[ci] !== items[i]) {
                cached = Array.from(items).filter(predicate);
                return cached;
            }
            ci++;
        }
        if (ci !== cached.length) {
            cached = Array.from(items).filter(predicate);
            return cached;
        }
        return cached;
    };
}

export type Primitive = null | undefined | string | number | boolean;
export type FragmentItem = Value<Primitive> | Component<Node | null> | FragmentItem[];

type Styles = {
    [K in keyof CSSStyleDeclaration as CSSStyleDeclaration[K] extends Function ? never : K]?: Value<CSSStyleDeclaration[K]>;
};

type PropertyAttributes<N> = {
    [K in keyof N as
        K extends string ? (
            K extends 'style' ? K :
            N[K] extends (Function | null | undefined) ? never :
            K extends WritableKeys<N> ? (N[K] extends Primitive ? K : never) :
            never
        ) : never
    ]?: K extends 'style' ? Styles : Value<N[K]>;
};

type EventAttributes<N extends Node | null> = {
    [K in keyof N as
        K extends string ? (
            N[K] extends (Function | null | undefined) ?
                (K extends `on${string}` ? K : never) :
                never
        ) : never
    ]?: RewriteThisParameter<N[K], N>;
};

type ComponentAttributes<N extends Node | null> = {
    onmount?: (this: Component<N>) => void;
    onmounted?: (this: Component<N>) => void;
    onunmount?: (this: Component<N>) => void;
    onupdate?: (this: Component<N>) => void | false;
};

export type Attributes<N extends Node | null> = PropertyAttributes<N> & EventAttributes<N> & ComponentAttributes<N>;

type RewriteThisParameter<F, N extends Node | null> =
    F extends (this: infer _, ...args: infer Args) => infer Ret ? (this: Component<N>, ...args: Args) => Ret :
    F extends (...args: infer Args) => infer Ret ? (this: Component<N>, ...args: Args) => Ret : never;


export class Context<T> {
    constructor(readonly name: string) {}

    Consume(bodyFunc: (value: T) => FragmentItem): Component<null> {
        const context = this;
        let lastValue: T | Nil = Nil;
        return new Component(null, this.name + '.Consume').addUpdateListener(function updateContextConsumer() {
            const value = this.getContext(context);
            if (value !== lastValue) {
                lastValue = value;
                this.replaceFragment(bodyFunc(value));
            }
        });
    }
}



let forceValuePropagation = false;

let mountedRootComponent: Component | null = null;
let suppressingUpdates = false;

function triggerAppUpdate() {
    if (!suppressingUpdates) {
        mountedRootComponent?.updateRoot();
    }
}

export class Component<out N extends Node | null = Node | null> {
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

    constructor(readonly node: N, private name?: string) {}

    getName(): string { return this.name ?? this.node?.nodeName ?? 'Component'; }
    setName(name: string): Component<N> {
        this.name = name;
        return this;
    }

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
        this.suspenseHandler = handler.bind(this);
        this.suspenseHandler(this.suspenseCount ?? 0); // always invoke (even with 0), so the handler can ensure things start out according to the current count
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

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => void): Component<N> {
        const self = this;
        if (!self.node) {
            throw new Error('addEventListener called on node-less component');
        }
        const boundListener = listener.bind(self);
        self.node.addEventListener(type, function listenerInvoker(ev): void {
            suppressingUpdates = true;
            try {
                boundListener(ev as GlobalEventHandlersEventMap[K]);
            } catch (e) {
                self.injectError(e);
                suppressingUpdates = false;
                return;
            }
            suppressingUpdates = false;
            self.updateRoot();
        });
        return this;
    }

    addMountListener(listener: (this: Component<N>) => void, invokeNow = false): Component<N> {
        const boundListener = listener.bind(this);
        if (this.mountListeners) {
            this.mountListeners.push(boundListener);
        } else {
            this.mountListeners = [boundListener];
        }
        if (this.mounted && invokeNow) {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        }
        return this;
    }

    addMountedListener(listener: (this: Component<N>) => void, invokeNow = false): Component<N> {
        const boundListener = listener.bind(this);
        if (this.mountedListeners) {
            this.mountedListeners.push(boundListener);
        } else {
            this.mountedListeners = [boundListener];
        }
        if (this.mounted && invokeNow) {
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

    addUpdateListener(listener: (this: Component<N>) => void | false, invokeNow = false): Component<N> {
        const boundListener = listener.bind(this);
        if (this.updateListeners) {
            this.updateListeners.push(boundListener);
        } else {
            this.updateListeners = [boundListener];
        }
        if (this.mounted && invokeNow) {
            try {
                boundListener();
            } catch (e) {
                this.injectError(e);
            }
        }
        return this;
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck: boolean = true): Component<N> {
        const self = this;
        const boundWatcher = watcher.bind(self);
        let lastEmittedValue: T | Nil = Nil;

        if (isStaticValue(value)) {
            onNewValue(value);
            return this;
        }

        this.addUpdateListener(function onValueWatcherUpdate() {
            const newValue = value();
            onNewValue(newValue);
        }, true);
        return this;

        function onNewValue(newValue: T): void {
            try {
                if (forceValuePropagation || !equalCheck || lastEmittedValue !== newValue) {
                    lastEmittedValue = newValue;
                    boundWatcher(newValue);
                }
            } catch (e) {
                self.injectError(e);
            }
        }
    }

    setAttributes<A extends N>(attributes: Attributes<A>): Component<N> {
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
                    this.addEventListener(name.substring(2) as any, value);
                    break;
                }
            } else if (name === 'style') {
                this.setStyle(value as Styles);
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

    setStyle(style: Styles): Component<N> {
        const elem = this.node;
        if (!(elem instanceof HTMLElement)) {
            throw new Error('style attribute requires node to be HTMLElement');
        }
        for (const styleName in style) {
            this.addValueWatcher(style[styleName]!, function onStyleChanged(primitive) {
                elem.style[styleName] = primitive;
            });
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

    removeChildren(children: Component[]): Component<N> {
        for (const child of children) {
            this.removeChild(child);
        }
        return this;
    }

    removeFromParent(): Component<N> {
        this.parent?.removeChild(this);
        return this;
    }

    insertAfter(child: Component, reference: Component | undefined): Component<N> {
        return this.insertBefore(child, reference?.nextSibling);
    }

    replaceChild(replacement: Component, replaced: Component): Component<N> {
        if (replacement === replaced) {
            return this;
        }
        if (replacement.parent === this) {
            this.removeChild(replacement);
        }
        this.insertBefore(replacement, replaced);
        this.removeChild(replaced);
        return this;
    }

    replaceChildren(children: Component[]): Component<N> {
        if (!this.firstChild) {
            return this.appendChildren(children);
        }

        // Map each new child to its target index
        const newIndex = new Map<Component, number>();
        for (let i = 0; i < children.length; i++) {
            newIndex.set(children[i]!, i);
        }

        // Walk old children: remove those absent from new list, collect new-indices of kept ones
        const keptNewIndices: number[] = [];
        const keptChildren: Component[] = [];
        let c = this.firstChild;
        while (c) {
            const next = c.nextSibling;
            const idx = newIndex.get(c);
            if (idx !== undefined) {
                keptNewIndices.push(idx);
                keptChildren.push(c);
            } else {
                this.removeChild(c);
            }
            c = next;
        }

        // Find LIS — these children are already in correct relative order and don't need to move
        const lisPositions = longestIncreasingSubsequence(keptNewIndices);
        const stable = new Set<Component>();
        for (const pos of lisPositions) {
            stable.add(keptChildren[pos]!);
        }

        // Walk new children right-to-left, using stable children as anchors
        let anchor: Component | undefined;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i]!;
            if (stable.has(child)) {
                anchor = child;
            } else {
                if (child.parent === this) {
                    this.removeChild(child);
                }
                this.insertBefore(child, anchor);
                anchor = child;
            }
        }

        return this;
    }

    replaceFragment(fragment: FragmentItem): Component<N> {
        this.replaceChildren(flattenFragment(fragment));
        return this;
    }

    appendChild(child: Component): Component<N> {
        return this.insertBefore(child);
    }

    appendChildren(children: Component[]): Component<N> {
        for (const child of children) {
            this.insertBefore(child);
        }
        return this;
    }

    appendFragment(fragment: FragmentItem): Component<N> {
        iterateFragment(fragment, this.insertBefore.bind(this));
        return this;
    }

    setLazyContent(fragmentFunc: (this: Component<N>) => FragmentItem | Promise<FragmentItem>, transient?: boolean): Component<N> {
        const boundFragmentFunc = fragmentFunc.bind(this);
        let counter = 0;
        let loaded = false;
        this.addMountListener(function onMountLazyContent() {
            if (loaded) {
                return;
            }
            loaded = true;
            const bodyResult = boundFragmentFunc();
            if (!(bodyResult instanceof Promise)) {
                this.replaceFragment(bodyResult);
                return;
            }
            const capturedCounter = ++counter;
            this.trackAsyncLoad(async function loadLazyBody() {
                const loadedBody = await bodyResult;
                if (capturedCounter === counter) {
                    this.replaceFragment(loadedBody);
                }
            });
        });
        if (transient) {
            this.addUnmountListener(function onUnmountLazyContent() {
                this.clear();
                loaded = false;
                ++counter;
            });
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
        mountedRootComponent = this;
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
        
        const prevForceValuePropagation = forceValuePropagation;
        forceValuePropagation = true;
        try {
            this.update(); // immediately update a mounted tree
        } finally {
            forceValuePropagation = prevForceValuePropagation;
        }
        
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
            if (p.detached) {
                break;
            }
            if (p.node) {
                return p.node;
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
    
    updateRoot(): void {
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

        
function visitFragment(fragment: FragmentItem, text: string, handler: (component: Component) => void): string {
    if (fragment === null) {
        return text;
    }
    switch (typeof fragment) {
    case 'boolean':
    case 'number':
    case 'string':
        text += fragment.toString();
    case 'undefined':
        return text;
    case 'function':
        if (text) {
            handler(StaticText(text));
        }
        handler(DynamicText(fragment));
        return '';
    default:
        if (fragment instanceof Component) {
            if (text) {
                handler(StaticText(text));
            }
            handler(fragment);
            return '';
        } else if (Array.isArray(fragment)) {
            for (const item of fragment) {
                text = visitFragment(item, text, handler);
            }
            return text;
        } else {
            throw new Error(`unexpected fragment object: ${fragment}`);
        }
    }
}

export function iterateFragment(rootFragment: FragmentItem, handler: (component: Component) => void): void {
    const text = visitFragment(rootFragment, '', handler);
    if (text) {
        handler(StaticText(text));
    }
}

export function flattenFragment(fragment: FragmentItem): Component[] {
    const components: Component[] = [];
    iterateFragment(fragment, components.push.bind(components));
    return components;
}



export const HTML = new Proxy({}, {
    get(target, name) {
        const tag = name.toString();

        return function createHtmlComponent() {
            const component = new Component(document.createElement(tag));

            if (arguments.length > 0) {
                let text = '';

                const insertBefore = component.insertBefore.bind(component);
                for (let i = 0; i < arguments.length; ++i) {
                    const arg = arguments[i];
                    if (isPlainObject(arg)) {
                        component.setAttributes(arg);
                    } else {
                        text = visitFragment(arg, text, insertBefore);
                    }
                }

                if (text) {
                    if (component.hasChildren()) {
                        component.insertBefore(StaticText(text));
                    } else {
                        // only set textContent if there were no other children
                        component.node.textContent = text;
                    }
                }
            }

            return component;
        }
    }
}) as {
    [Tag in keyof HTMLElementTagNameMap]: HTMLComponentConstructor<Tag>;
};

export type HTMLChildFragment<T extends HTMLElement> = FragmentItem | Attributes<T>;

type HTMLComponentConstructor<Tag extends keyof HTMLElementTagNameMap> = (...children: HTMLChildFragment<HTMLElementTagNameMap[Tag]>[]) => Component<HTMLElementTagNameMap[Tag]>;


export function StaticText(value: string): Component<Text> {
    return new Component(document.createTextNode(value));
}

export function DynamicText(value: Value<Primitive>): Component<Text> {
    return new Component(document.createTextNode('')).addValueWatcher(value, function onDynamicTextChanged(primitive) {
        this.node.nodeValue = primitive?.toString() ?? '';
    });
}


export function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> {
    return new Component(null, name ?? 'With').addValueWatcher(value, function evalWith(v) {
        this.replaceChildren(flattenFragment(mapper(v)));
    });
}

export function If(condValue: Value<boolean>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> {
    let thenComponents: Component[] | undefined;
    let elseComponents: Component[] | undefined;
    return new Component(null, 'If').addValueWatcher(condValue, function evalIf(v) {
        if (v) {
            this.replaceChildren(thenComponents ??= flattenFragment(thenFragment));
        } else {
            this.replaceChildren(elseComponents ??= flattenFragment(elseFragment));
        }
    });
}

export function When(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> {
    let bodyComponents: Component[] | undefined;
    return new Component(null, 'When').addValueWatcher(condValue, function evalWhen(v) {
        if (v) {
            this.appendChildren(bodyComponents ??= flattenFragment(bodyFragment));
        } else {
            this.clear();
        }
    });
}

export function Unless(condValue: Value<boolean>, ...bodyFragment: FragmentItem[]): Component<null> {
    let bodyComponents: Component[] | undefined;
    return new Component(null, 'Unless').addValueWatcher(condValue, function evalUnless(v) {
        if (v) {
            this.clear();
        } else {
            this.appendChildren(bodyComponents ??= flattenFragment(bodyFragment));
        }
    });
}

export function Match<T extends Primitive>(value: Value<T>, ...alternatives: [T | ((v: T) => boolean), ...FragmentItem[]][]): Component<null> {
    const componentLists = alternatives.map(alt => flattenFragment(alt.slice(1) as FragmentItem));
    return new Component(null, 'Match').addValueWatcher(value, function evalMatch(v) {
        for (let i = 0; i < alternatives.length; ++i) {
            const matcher = alternatives[i]![0];
            if (typeof matcher === 'function' ? matcher(v) : v === matcher) {
                this.replaceChildren(componentLists[i]!);
                return;
            }
        }
    });
}
export function Else(_: unknown): true {
    return true;
}

export function For<T extends object>(itemsValue: Value<ReadonlyArray<T>>, renderFunc: (getItem: () => T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null> {
    const keyOf = keyFunc ?? (item => item);
    const itemsByKey = new Map<unknown, T>();
    let fragmentMap = new Map<unknown, Component[]>();
    let lastKeys: unknown[] = [];
    let lastItems: T[] | undefined;

    return new Component(null, 'For').addValueWatcher(itemsValue, function onForItemsChanged(items) {
        // Fast path: shallow compare with last reconciled items
        if (lastItems && items.length === lastItems.length) {
            let same = true;
            for (let i = 0; i < items.length; ++i) {
                const key = keyOf(items[i]);
                if (items[i] !== lastItems[i] || key !== lastKeys[i]) {
                    same = false;
                    break;
                }
            }
            if (same) return; // zero writes!
        }

        // Slow path: reconcile and snapshot
        itemsByKey.clear();
        const newFragmentMap = new Map<unknown, Component[]>();
        const newKeys: unknown[] = [];
        const children: Component[] = [];
        for (const item of items) {
            const key = keyOf(item);
            itemsByKey.set(key, item);
            newKeys.push(key);
            const fragment = fragmentMap.get(key) ?? flattenFragment(renderFunc(() => {
                const item = itemsByKey.get(key);
                if (item === undefined) {
                    throw new Error('missing item in For itemsByKey');
                }
                return item;
            }));
            newFragmentMap.set(key, fragment);
            for (const c of fragment) children.push(c);
        }
        lastItems = items.slice();
        lastKeys = newKeys;
        fragmentMap = newFragmentMap;
        this.replaceChildren(children);
    }, false);
}

export function Repeat(countValue: Value<number>, itemFunc: (i: number) => FragmentItem): Component<null> {
    const fragmentSizes: number[] = [];
    return new Component(null, 'Repeat').addValueWatcher(countValue, function onCountChanged(count) {
        while (fragmentSizes.length > count && fragmentSizes.length > 0) {
            const fragmentSize = fragmentSizes.pop()!;
            for (let i = 0; i < fragmentSize; ++i) {
                this.removeChild(this.getLastChild()!);
            }
        }
        while (fragmentSizes.length < count) {
            const fragment = flattenFragment(itemFunc(fragmentSizes.length));
            fragmentSizes.push(fragment.length);
            this.appendChildren(fragment);
        }
    });
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
            const fragment = boundFallback(error, initContent);
            component.clear();
            component.appendFragment(fragment);
        } catch (e) {
            const msg = `Error in ErrorBoundary fallback: ${(errorDescription(e))}`;
            console.error(msg);
            component.clear();
            component.insertBefore(StaticText(msg));
        }
        return true;
    }

    function initContent(): void {
        try {
            const fragment = boundBody();
            component.clear();
            component.appendFragment(fragment);
        } catch (e) {
            onError(e);
        }
    }
}


export function Suspense(fallbackFragment: FragmentItem, ...bodyFragment: FragmentItem[]): Component<null> {
    const bodyComponents = flattenFragment(bodyFragment);
    if (bodyComponents.length === 0) {
        return new Component(null, 'Suspense');
    }
    
    const fallbackComponents = flattenFragment(fallbackFragment);
    for (const c of fallbackComponents) {
        c.setSuspenseHandler(function fallbackSuspenseGuard(count) {
            if (count > 0) {
                throw new Error('Suspense fallback must not cause suspension');
            }
        });
    }
    
    return new Component(null, 'Suspense').appendChildren(bodyComponents).setSuspenseHandler(function suspenseHandler(count) {
        if (count > 0) {
            if (!bodyComponents[0]!.isDetached()) {
                for (const c of bodyComponents) {
                    c.setDetached(true);
                }
                this.appendChildren(fallbackComponents);
            }
        } else {
            if (bodyComponents[0]!.isDetached()) {
                this.removeChildren(fallbackComponents);
                for (const c of bodyComponents) {
                    c.setDetached(false);
                }
            }
        }
    });
}

export function Unsuspense(...bodyFragment: FragmentItem[]) {
    return new Component(null, 'Unsuspense')
        .setSuspenseHandler(function noopSuspenseHandler() { })
        .appendFragment(bodyFragment);
}


export function Lazy(bodyFunc: (this: Component<null>) => FragmentItem | Promise<FragmentItem>): Component<null> {
    return new Component(null, 'Lazy').setLazyContent(bodyFunc);
}

export function Transient(bodyFunc: (this: Component<null>) => FragmentItem | Promise<FragmentItem>): Component<null> {
    return new Component(null, 'Transient').setLazyContent(bodyFunc, true);
}

export function Async(promise: Promise<FragmentItem>): Component<null> {
    const component = new Component(null, 'Async');
    component.trackAsyncLoad(async function loadAsyncFragment() {
        component.appendFragment(await promise);
    });
    return component;
}


export interface VirtualListOptions<T extends object> {
    items: Value<ReadonlyArray<T>>;
    estimateSize: number;
    direction?: 'vertical' | 'horizontal';
    buffer?: number;
    render: (item: T) => FragmentItem;
    key?: (item: T) => unknown;
}

export function VirtualList<T extends object>(opts: VirtualListOptions<T>): Component<HTMLDivElement> {
    const keyOf = opts.key ?? (item => item);
    const buffer = opts.buffer ?? 3;
    const horizontal = opts.direction === 'horizontal';
    const estimateSize = opts.estimateSize;
    const itemsValue = opts.items;
    const renderFunc = opts.render;

    const wrapperMap = new Map<unknown, Component<HTMLDivElement>>();
    const measuredSizes = new Map<unknown, number>();
    let visibleKeys = new Set<unknown>();
    let prevVisible = new Set<unknown>();
    let offsets = new Float64Array(0);
    let offsetsDirty = true;
    let lastItemCount = -1;
    let lastSpacerSize = -1;
    let reconcileGeneration = 0;
    let lastReconciledGeneration = -1;

    // Measure actual item sizes
    const wrapperToKey = new Map<Element, unknown>();
    let rafPending = false;
    const observer = new ResizeObserver(entries => {
        let dirty = false;
        for (const entry of entries) {
            const key = wrapperToKey.get(entry.target);
            if (key === undefined) continue;
            const size = horizontal
                ? entry.borderBoxSize[0].inlineSize
                : entry.borderBoxSize[0].blockSize;
            if (size > 0 && measuredSizes.get(key) !== size) {
                measuredSizes.set(key, size);
                dirty = true;
            }
        }
        if (dirty) {
            offsetsDirty = true;
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false;
                    reconcile();
                });
            }
        }
    });

    function sizeOf(key: unknown): number {
        return measuredSizes.get(key) ?? estimateSize;
    }

    const spacer = new Component(document.createElement('div'), 'VirtualList.spacer');
    spacer.node.style.position = 'relative';

    const container = new Component(document.createElement('div'), 'VirtualList.container');
    container.node.style.overflow = 'auto';
    if (horizontal) {
        container.node.style.overflowY = 'hidden';
    }
    container.appendChild(spacer);

    container.addEventListener('scroll', function() {
        ++reconcileGeneration;
        reconcile();
    });
    container.addUpdateListener(reconcile);
    container.addMountedListener(function() {
        requestAnimationFrame(reconcile);
    });
    container.addUnmountListener(function() {
        observer.disconnect();
    });

    return container;

    function reconcile() {
        const items = isStaticValue(itemsValue) ? itemsValue : itemsValue();
        const n = items.length;
        const scrollPos = horizontal ? container.node.scrollLeft : container.node.scrollTop;
        const viewportSize = horizontal ? container.node.clientWidth : container.node.clientHeight;

        if (viewportSize === 0) return;

        // Skip if already reconciled this generation (avoids double reconcile from scroll + updateRoot)
        if (reconcileGeneration === lastReconciledGeneration && !offsetsDirty && n === lastItemCount) return;
        lastReconciledGeneration = reconcileGeneration;

        // Recompute cumulative offsets only when measurements or items changed
        if (offsetsDirty || n !== lastItemCount) {
            if (offsets.length < n + 1) {
                offsets = new Float64Array(n + 1);
            }
            for (let i = 0; i < n; i++) {
                offsets[i + 1] = offsets[i] + sizeOf(keyOf(items[i]));
            }
            offsetsDirty = false;
            lastItemCount = n;

            const spacerSize = Math.round(offsets[n]);
            if (spacerSize !== lastSpacerSize) {
                if (horizontal) {
                    spacer.node.style.width = spacerSize + 'px';
                    spacer.node.style.height = '100%';
                } else {
                    spacer.node.style.height = spacerSize + 'px';
                }
                lastSpacerSize = spacerSize;
            }
        }

        // Binary search for first visible item (first i where offsets[i+1] > scrollPos)
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (offsets[mid + 1] <= scrollPos) lo = mid + 1;
            else hi = mid;
        }
        const start = Math.max(0, lo - buffer);

        // Binary search for first item past viewport (first i where offsets[i] >= scrollPos + viewportSize)
        lo = start; hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (offsets[mid] < scrollPos + viewportSize) lo = mid + 1;
            else hi = mid;
        }
        const end = Math.min(n, lo + buffer);

        // Reuse Set from previous reconcile
        const newVisible = prevVisible;
        newVisible.clear();

        for (let i = start; i < end; i++) {
            const item = items[i];
            const key = keyOf(item);
            newVisible.add(key);

            let wrapper = wrapperMap.get(key);
            if (!wrapper) {
                wrapper = new Component(document.createElement('div'), 'VirtualList.item');
                wrapper.node.style.position = 'absolute';
                if (horizontal) {
                    wrapper.node.style.top = '0';
                    wrapper.node.style.bottom = '0';
                } else {
                    wrapper.node.style.left = '0';
                    wrapper.node.style.right = '0';
                }
                wrapper.appendFragment(renderFunc(item));
                wrapperMap.set(key, wrapper);
                wrapperToKey.set(wrapper.node, key);
                observer.observe(wrapper.node);
            }

            // Reposition (transform is composite-only, cheap even when unchanged)
            wrapper.node.style.transform = horizontal
                ? `translateX(${offsets[i]}px)` : `translateY(${offsets[i]}px)`;

            if (!visibleKeys.has(key)) {
                spacer.appendChild(wrapper);
            }
        }

        for (const key of visibleKeys) {
            if (!newVisible.has(key)) {
                spacer.removeChild(wrapperMap.get(key)!);
            }
        }
        prevVisible = visibleKeys;
        visibleKeys = newVisible;
    }
}


// Store system

export type DeepReadonly<T> =
    T extends Function ? T :
    T extends (infer U)[] ? readonly DeepReadonly<U>[] :
    T extends Map<infer K, infer V> ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>> :
    T extends Set<infer U> ? ReadonlySet<DeepReadonly<U>> :
    T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
    T;

export type StoreView<T extends Store> = {
    readonly [K in keyof T as K extends keyof Store ? never : K]:
        T[K] extends (...args: infer A) => infer R ? (...args: A) => R :
        DeepReadonly<T[K]>
} & {
    derived<R>(selector: (self: StoreView<T>) => R): () => R;
    provide(component: Component): StoreView<T>;
};

export class Store {
    private _generation = 0;
    private _dispatching = false;

    private static _contexts = new WeakMap<Function, Context<any>>();

    private static _getContext(ctor: Function): Context<any> {
        let ctx = Store._contexts.get(ctor);
        if (!ctx) {
            ctx = new Context(ctor.name || 'Store');
            Store._contexts.set(ctor, ctx);
        }
        return ctx;
    }

    constructor() {
        const storeProto = Store.prototype;
        const proto = Object.getPrototypeOf(this);
        for (const key of Object.getOwnPropertyNames(proto)) {
            if (key === 'constructor') continue;
            if (key in storeProto) continue;
            const desc = Object.getOwnPropertyDescriptor(proto, key);

            if (typeof desc?.value === 'function') {
                // Wrap method as action: auto-increment generation + trigger update
                const method = desc.value;
                const self = this;
                (this as any)[key] = function(...args: any[]) {
                    const wasDispatching = self._dispatching;
                    self._dispatching = true;
                    try {
                        return method.apply(self, args);
                    } finally {
                        self._generation++;
                        if (!wasDispatching) {
                            self._dispatching = false;
                            triggerAppUpdate();
                        }
                    }
                };
            } else if (desc?.get) {
                // Wrap getter with generation-based caching
                const getter = desc.get;
                const self = this;
                let cachedGen = -1;
                let cached: any;
                Object.defineProperty(this, key, {
                    get() {
                        if (cachedGen !== self._generation) {
                            cached = getter.call(self);
                            cachedGen = self._generation;
                        }
                        return cached;
                    },
                    enumerable: true,
                });
            }
        }
    }

    derived<R>(selector: (self: this) => R): () => R {
        let cachedGen = -1;
        let cached: R;
        const self = this;
        return () => {
            if (cachedGen !== self._generation) {
                cached = selector(self);
                cachedGen = self._generation;
            }
            return cached;
        };
    }

    provide(component: Component): this {
        component.provideContext(Store._getContext(this.constructor), this as any);
        return this;
    }

    static context<T extends Store>(this: new (...args: any[]) => T): Context<StoreView<T>> {
        return Store._getContext(this);
    }

    static from<T extends Store>(this: new (...args: any[]) => T, component: Component): StoreView<T> {
        return component.getContext(Store._getContext(this));
    }

    static create<T extends Store>(this: new () => T): StoreView<T> {
        return new this() as StoreView<T>;
    }
}
