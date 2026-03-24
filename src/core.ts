import { type WritableKeys, errorDescription, isPlainObject, type ThinVec, tvPush, tvForEach } from './util';
import { Observable, Effect, Signal, DelegatedSignal, observableProxy, signalProxy, type ObservableProxy, type SignalProxy, type EffectOptions } from './observable';

declare global {
    interface Document {
        startViewTransition(callback: () => void): { finished: Promise<void> };
    }
}

export let onAsyncLoadStart: ((c: Component) => void) | undefined;
export let onAsyncLoadEnd: ((c: Component) => void) | undefined;
export let onQueryBind: ((component: Component, key: string) => object | null) | undefined;

export function setServerHooks(hooks: {
    onAsyncLoadStart?: (c: Component) => void;
    onAsyncLoadEnd?: (c: Component) => void;
    onQueryBind?: (component: Component, key: string) => object | null;
}): void {
    if (hooks.onAsyncLoadStart !== undefined) onAsyncLoadStart = hooks.onAsyncLoadStart;
    if (hooks.onAsyncLoadEnd !== undefined) onAsyncLoadEnd = hooks.onAsyncLoadEnd;
    if (hooks.onQueryBind !== undefined) onQueryBind = hooks.onQueryBind;
}

const Nil: unique symbol = Symbol('Nil');
type Nil = typeof Nil;

export type Pollable<T> = T | (() => T);
export type Value<T> = Pollable<T> | Observable<T>;

export function isStaticValue<T>(value: Value<T>): value is T {
    return typeof value !== 'function' && !(value instanceof Observable);
}

export function toGetter<T>(value: Value<T>): () => T {
    if (isStaticValue(value)) return () => value;
    if (value instanceof Observable) return () => value.get();
    return value;
}

export function getValue<T>(value: Value<T>): T {
    if (isStaticValue(value)) return value;
    if (value instanceof Observable) return value.get();
    return value();
}

export function fields<T extends object>(source: () => T): { readonly [K in keyof T]: () => T[K] } {
    return new Proxy({} as any, {
        get(_, key: string | symbol) {
            return () => (source() as any)[key];
        }
    });
}

export function memoFilter<T>(source: Pollable<ReadonlyArray<T>>, predicate: (item: T) => boolean): () => T[] {
    const getItems = toGetter(source);
    let cached: T[] = [];
    return () => {
        const items = getItems();
        let ci = 0;
        for (let i = 0; i < items.length; ++i) {
            if (!predicate(items[i]!)) continue;
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
    onmount?: (this: Component<N>) => void | Promise<void>;
    onmounted?: (this: Component<N>) => void | Promise<void>;
    onunmount?: (this: Component<N>) => void;
    onupdate?: (this: Component<N>) => void | false;
    onexit?: (this: Component<N>, done: () => void) => void;
};

export type Attributes<N extends Node | null> = PropertyAttributes<N> & EventAttributes<N> & ComponentAttributes<N>;

type RewriteThisParameter<F, N extends Node | null> =
    F extends (this: infer _, ...args: infer Args) => infer Ret ? (this: Component<N>, ...args: Args) => Ret :
    F extends (...args: infer Args) => infer Ret ? (this: Component<N>, ...args: Args) => Ret : never;


export class Context<T> {
    constructor(readonly name: string) { }

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



let updateDepth = 0;
let pendingUpdateRoot: Component | null = null;


type ObservableEffectOptions<N extends Node | null> = Omit<EffectOptions, 'active' | 'activated' | 'deactivated'> & {
    activated?(this: Component<N>): void;
    deactivated?(this: Component<N>): void;
};

export class Component<out N extends Node | null = Node | null> {
    public node: N;
    private name: string | undefined;

    private parent: Component | undefined;
    private firstChild: Component | undefined;
    private lastChild: Component | undefined;
    private nextSibling: Component | undefined;
    private prevSibling: Component | undefined;

    private detached: boolean;
    private mounted: boolean;
    private mountListeners: ThinVec<() => void | Promise<void>>;
    private mountedListeners: ThinVec<() => void | Promise<void>>;
    private unmountListeners: ThinVec<() => void>;
    private updateListeners: (() => void | false)[] | undefined;
    private hasUpdaters: boolean;

    private unhandledError: unknown | undefined;
    private errorHandler: ((error: unknown) => boolean) | undefined;

    private suspenseCount: number;
    private suspenseHandler: ((count: number) => void) | undefined;

    private exitHandler: ((done: () => void) => void) | undefined;
    private exitCleanup: (() => void) | undefined;

    private contextValues: Map<Context<unknown>, unknown> | undefined;

    // Scratch field used by replaceChildren for reconciliation. -1 = not participating,
    // -2 = stable (in LIS), ≥0 = target index in new children array.
    private reconcileIdx: number;

    constructor(node: N, name?: string) {
        this.node = node;
        this.name = name;

        this.parent = undefined;
        this.firstChild = undefined;
        this.lastChild = undefined;
        this.nextSibling = undefined;
        this.prevSibling = undefined;

        this.detached = false;
        this.mounted = false;
        this.mountListeners = undefined;
        this.mountedListeners = undefined;
        this.unmountListeners = undefined;
        this.updateListeners = undefined;
        this.hasUpdaters = false;

        this.unhandledError = undefined;
        this.errorHandler = undefined;

        this.suspenseCount = 0;
        this.suspenseHandler = undefined;

        this.exitHandler = undefined;
        this.exitCleanup = undefined;

        this.contextValues = undefined;

        this.reconcileIdx = -1;
    }

    getName(): string { return this.name ?? this.node?.nodeName ?? 'Component'; }

    getParent(): Component | undefined { return this.parent; }
    getFirstChild(): Component | undefined { return this.firstChild; }
    getLastChild(): Component | undefined { return this.lastChild; }
    getNextSibling(): Component | undefined { return this.nextSibling; }
    getPrevSibling(): Component | undefined { return this.prevSibling; }

    hasChildren(): boolean { return !!this.firstChild; }

    isDetached(): boolean { return this.detached; }

    getRoot(): Component {
        let c: Component = this;
        while (c.parent) { c = c.parent; }
        return c;
    }

    private commonAncestor(b: Component): Component {
        let a: Component = this;
        let da = 0, db = 0;
        for (let c: Component | undefined = a; c; c = c.parent) da++;
        for (let c: Component | undefined = b; c; c = c.parent) db++;
        while (da > db) { a = a.parent!; da--; }
        while (db > da) { b = b.parent!; db--; }
        while (a !== b) { a = a.parent!; b = b.parent!; }
        return a;
    }

    injectError(error: unknown): void {
        let c: Component = this;
        for (; ;) {
            try {
                if (c.errorHandler?.call(c, error) === true) {
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
        this.errorHandler = handler;
        const unhandled = this.unhandledError;
        if (unhandled) {
            this.unhandledError = undefined;
            this.injectError(unhandled);
        }
        return this;
    }

    setExitHandler(handler: (this: Component<N>, done: () => void) => void): Component<N> {
        this.exitHandler = handler;
        return this;
    }

    cancelExit(): Component<N> {
        this.exitHandler = undefined;
        if (this.exitCleanup) {
            this.exitCleanup();
        }
        return this;
    }

    setSuspenseHandler(handler: (this: Component<N>, count: number) => void): Component<N> {
        if (this.suspenseCount && this.parent && !this.suspenseHandler) {
            // we don't contribute to parent count when we have a handler
            this.parent.addSuspenseCount(-this.suspenseCount);
        }
        this.suspenseHandler = handler;
        this.suspenseHandler.call(this, this.suspenseCount); // always invoke (even with 0), so the handler can ensure things start out according to the current count
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

    addEventListener<K extends keyof GlobalEventHandlersEventMap>(type: K, listener: (this: Component<N>, ev: GlobalEventHandlersEventMap[K]) => void | false | Promise<void>): Component<N> {
        const self = this;
        if (!self.node) {
            throw new Error('addEventListener called on node-less component');
        }
        self.node.addEventListener(type, function eventListenerInvoker(ev): void {
            let result: void | false | Promise<void>;
            try {
                result = listener.call(self, ev as GlobalEventHandlersEventMap[K]);
            } catch (e) {
                self.injectError(e);
                return;
            }
            if (result === false) {
                // do nothing
            } else if (result instanceof Promise) {
                self.trackAsyncLoad(result);
            } else {
                self.updateRoot();
            }
        });
        return this;
    }

    addMountListener(listener: (this: Component<N>) => void | Promise<void>, invokeNow = false): Component<N> {
        this.mountListeners = tvPush(this.mountListeners, listener);
        if (this.mounted && invokeNow) {
            let result: void | Promise<void> = undefined;
            try {
                result = listener.call(this);
            } catch (e) {
                this.injectError(e);
            }
            if (result instanceof Promise) {
                this.trackAsyncLoad(result);
            }
        }
        return this;
    }

    addMountedListener(listener: (this: Component<N>) => void | Promise<void>, invokeNow = false): Component<N> {
        this.mountedListeners = tvPush(this.mountedListeners, listener);
        if (this.mounted && invokeNow) {
            let result: void | Promise<void> = undefined;
            try {
                result = listener.call(this);
            } catch (e) {
                this.injectError(e);
            }
            if (result instanceof Promise) {
                this.trackAsyncLoad(result);
            }
        }
        return this;
    }

    addUnmountListener(listener: (this: Component<N>) => void): Component<N> {
        this.unmountListeners = tvPush(this.unmountListeners, listener);
        return this;
    }

    addEffect(fn: (this: Component<N>) => ((this: Component<N>) => void) | void): Component<N> {
        let cleanup: ((this: Component<N>) => void) | null = null;
        this.addMountedListener(function onEffectMount(this: Component<N>) {
            cleanup = fn.call(this) ?? null;
        });
        this.addUnmountListener(function onEffectUnmount() {
            cleanup?.call(this);
            cleanup = null;
        });
        return this;
    }

    addObservableEffect(effect: Effect): Component<N>;
    addObservableEffect(fn: (this: Component<N>) => void, options?: ObservableEffectOptions<N>): Component<N>;
    addObservableEffect(effectOrFn: Effect | ((this: Component<N>) => void), options?: ObservableEffectOptions<N>): Component<N> {
        const effect = effectOrFn instanceof Effect ? effectOrFn : new Effect(effectOrFn.bind(this), {
            ...options,
            active: false,
            activated: options?.activated?.bind(this),
            deactivated: options?.deactivated?.bind(this)
        });
        this.addMountListener(() => effect.activate());
        this.addUnmountListener(() => effect.deactivate());
        return this;
    }

    addUpdateListener(listener: (this: Component<N>) => void | false, invokeNow = false): Component<N> {
        const wasEmpty = !this.updateListeners;
        (this.updateListeners ??= []).push(listener);
        if (wasEmpty) this.propagateHasUpdaters();
        if (this.mounted && invokeNow) {
            try {
                listener.call(this);
            } catch (e) {
                this.injectError(e);
            }
        }
        return this;
    }

    guardUpdate<S>(source: () => S): Component<N> {
        let prev: S;
        let init = false;
        return this.addUpdateListener(() => {
            const s = source();
            if (init && s === prev) return false;
            init = true;
            prev = s;
            return;
        });
    }

    addValueWatcher<T>(value: Value<T>, watcher: (this: Component<N>, v: T) => void, equalCheck: boolean = true): Component<N> {
        if (isStaticValue(value)) {
            try {
                watcher.call(this, value);
            } catch (e) {
                this.injectError(e);
            }
            return this;
        }

        if (value instanceof Observable) {
            let lastEmittedValue: T | Nil = Nil;
            this.addObservableEffect(() => {
                const newValue = value.get();
                if (!equalCheck || lastEmittedValue !== newValue) {
                    lastEmittedValue = newValue;
                    try { watcher.call(this, newValue); } catch (e) { this.injectError(e); }
                }
            }, { deactivated() { lastEmittedValue = Nil; } });
            return this;
        }

        // value is 'function'
        let lastEmittedValue: T | Nil = Nil;
        this.addUpdateListener(function onValueWatcherUpdate(this: Component<N>) {
            const newValue = value();
            if (!equalCheck || lastEmittedValue !== newValue) {
                lastEmittedValue = newValue;
                watcher.call(this, newValue);
            }
        }, true);
        this.addUnmountListener(() => { lastEmittedValue = Nil; });
        return this;
    }

    async trackAsyncLoad(load: Promise<void | false> | ((this: Component<N>) => Promise<void | false>)): Promise<void> {
        onAsyncLoadStart?.(this);
        this.addSuspenseCount(1);
        try {
            const result = await (load instanceof Promise ? load : load.call(this));
            if (result !== false) {
                this.updateRoot();
            }
        } catch (e) {
            this.injectError(e);
        } finally {
            this.addSuspenseCount(-1);
            onAsyncLoadEnd?.(this);
        }
    }

    addValueLoader<T>(value: Value<T>, loader: (this: Component<N>, v: T) => Promise<() => void>): Component<N> {
        let counter = 0;
        let lastKey: T | Nil = Nil;
        // equalCheck: false — we do our own dedup via lastKey, which intentionally survives
        // unmount/remount so the same key on re-mount does not re-trigger the load.
        return this.addValueWatcher(value, function onLoadKeyChanged(this: Component<N>, key) {
            if (key === lastKey) return;
            lastKey = key;
            const capturedCounter = ++counter;
            this.trackAsyncLoad(async function runValueLoader() {
                const apply = await loader.call(this, key);
                if (capturedCounter == counter) {
                    apply();
                    return;
                }
                return false;
            });
        }, false);
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
                    case 'onexit':
                        this.setExitHandler(value);
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
        if (child.exitCleanup) {
            child.exitCleanup(); // cancel in-progress exit, remove lingering DOM nodes
        }
        if (child.parent) {
            throw new Error('component is already attached to a component');
        }

        // Link child into the tree first so that parent/sibling pointers are valid
        // during doMount — this lets getContext traverse correctly without pendingParent,
        // and ensures commonAncestor works if update() is called re-entrantly from doMount.
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

        if (child.hasUpdaters) this.propagateHasUpdaters();

        if (child.suspenseCount && !child.suspenseHandler) {
            // Propagate pre-existing suspense counts before doMount. Any suspense added
            // during doMount (via trackAsyncLoad) propagates naturally through the parent link.
            this.addSuspenseCount(child.suspenseCount);
        }

        let pendingMountedCalls: Component[] | undefined;
        if (this.mounted && !child.mounted) {
            pendingMountedCalls = child.doMount();
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

        if (updateDepth === 0 && child.mounted) {
            child.update();
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
                if (child.exitHandler) {
                    child.beginExit(container);
                } else {
                    child.removeNodesFrom(container);
                }
            }
        }

        if (child.hasUpdaters) this.propagateClearHasUpdaters();

        if (child.suspenseCount && !child.suspenseHandler) {
            // child component doesn't have a suspense handler and thus will have spilled its suspense count up to us, so we must subtract it.
            this.addSuspenseCount(-child.suspenseCount);
        }

        if (child.mounted) {
            child.unmount();
        }

        return this;
    }

    private beginExit(container: Node): void {
        const handler = this.exitHandler!;
        this.exitHandler = undefined;

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            this.exitCleanup = undefined;
            this.removeNodesFrom(container);
        };
        this.exitCleanup = cleanup;

        try {
            handler.call(this, cleanup);
        } catch (e) {
            cleanup();
            console.error('exit handler error:', e);
        }
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

    // Move a child to a new position within this component without triggering lifecycle.
    // Only rewires sibling pointers and repositions DOM nodes — the child stays mounted,
    // thunks stay evaluated, and hasUpdaters/suspenseCount are unchanged (same parent).
    private moveChildBefore(child: Component, anchor: Component | undefined): void {
        // Unlink from current position
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

        // Re-link at new position
        if (anchor) {
            child.prevSibling = anchor.prevSibling;
            child.nextSibling = anchor;
            if (anchor.prevSibling) {
                anchor.prevSibling.nextSibling = child;
            } else {
                this.firstChild = child;
            }
            anchor.prevSibling = child;
        } else {
            child.prevSibling = this.lastChild;
            child.nextSibling = undefined;
            if (this.lastChild) {
                this.lastChild.nextSibling = child;
            } else {
                this.firstChild = child;
            }
            this.lastChild = child;
        }

        // Move DOM nodes. Child is now re-linked so getInsertionAnchor() reflects the new
        // position and gives the correct DOM node to insert before.
        if (!child.detached) {
            const container = this.getChildContainerNode();
            if (container) {
                child.moveNodesInto(container, child.getInsertionAnchor());
            }
        }
    }

    replaceChildren(children: Component[]): Component<N> {
        if (!this.firstChild) {
            for (const child of children) {
                this.insertBefore(child);
            }
            return this;
        }

        // Mark each new child with its target index (avoids Map allocation)
        for (let i = 0; i < children.length; i++) {
            children[i]!.reconcileIdx = i;
        }

        // Walk old children: remove those absent from new list, collect kept ones.
        // Track whether kept indices are already ascending — when true (the common case:
        // partial update, select row, append) we can skip LIS entirely.
        const keptChildren = Component.keptChildren;
        keptChildren.length = 0;
        let sorted = true;
        let prevReconcileIdx = -1;
        let c = this.firstChild;
        while (c) {
            const next = c.nextSibling;
            if (c.reconcileIdx >= 0) {
                if (c.reconcileIdx < prevReconcileIdx) {
                    sorted = false;
                }
                prevReconcileIdx = c.reconcileIdx;
                keptChildren.push(c);
            } else {
                this.removeChild(c);
            }
            c = next!;
        }

        // Fast path: already in order — all kept children are stable, skip LIS
        if (sorted) {
            for (const child of keptChildren) {
                child.reconcileIdx = -2;
            }
        } else {
            Component.markStableLIS(keptChildren);
        }
        keptChildren.length = 0; // release refs so GC can collect unmounted components

        // Walk new children right-to-left, using stable children as anchors.
        // Clear reconcileIdx as we go so each component is reset for future reconciliations.
        let anchor: Component | undefined;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i]!;
            const idx = child.reconcileIdx;
            child.reconcileIdx = -1;
            if (idx === -2) {
                anchor = child;
            } else {
                if (child.parent === this) {
                    this.moveChildBefore(child, anchor);
                } else {
                    this.insertBefore(child, anchor);
                }
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
        iterateFragment(fragment, this, this.insertBefore);
        return this;
    }

    setLazyContent(fragmentFunc: (this: Component<N>) => FragmentItem | Promise<FragmentItem>, transient?: boolean): Component<N> {
        let counter = 0;
        let loaded = false;
        this.addMountListener(function onMountLazyContent() {
            if (loaded) {
                return;
            }
            loaded = true;
            const bodyResult = fragmentFunc.call(this);
            if (!(bodyResult instanceof Promise)) {
                this.replaceFragment(bodyResult);
                return;
            }
            const capturedCounter = ++counter;
            this.trackAsyncLoad(async function loadLazyBody() {
                const loadedBody = await bodyResult;
                if (capturedCounter === counter) {
                    this.replaceFragment(loadedBody);
                    return;
                }
                return false;
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
        for (; ;) {
            const child = this.firstChild;
            if (!child) {
                break;
            }
            this.removeChild(child);
        }
        return this;
    }

    forceClear(): Component<N> {
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.cancelExit();
        }
        this.clear();
        // Remove any lingering DOM from already-unlinked exiting components
        const container = this.getChildContainerNode();
        if (container) {
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
        }
        return this;
    }

    withViewTransition(fn: () => void): false {
        const doUpdate = () => {
            fn();
            this.updateRoot();
        };
        if (document.startViewTransition) {
            document.startViewTransition(doUpdate);
        } else {
            doUpdate();
        }
        return false;
    }

    mount(): Component<N> {
        const pendingMountedCalls = this.doMount();
        this.update();
        this.signalMounted(pendingMountedCalls);
        return this;
    }

    private signalMounted(components: Component[]): void {
        for (let i = components.length - 1; i >= 0; i--) {
            const component = components[i]!;
            tvForEach(component.mountedListeners, listener => {
                let result: void | Promise<void> = undefined;
                try {
                    result = listener.call(component);
                } catch (e) {
                    component.injectError(e);
                }
                if (result instanceof Promise) {
                    component.trackAsyncLoad(result);
                }
            });
        }
    }

    private doMount(): Component[] {
        const pendingMountedCalls: Component[] = [];
        const stack: Component[] = [this];
        for (; ;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (component.mounted) {
                continue;
            }
            component.mounted = true;

            if (component.mountListeners) {
                tvForEach(component.mountListeners, listener => {
                    let result: void | Promise<void> = undefined;
                    try {
                        result = listener.call(component);
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (result instanceof Promise) {
                        component.trackAsyncLoad(result);
                    }
                    if (!component.mounted) {
                        return false; // in case a mount handler caused the tree to be (synchronously) unmounted
                    }
                    return;
                });
                if (!component.mounted) {
                    return [];
                }
            }

            if (component.mountedListeners) {
                pendingMountedCalls.push(component);
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                stack.push(c);
            }
        }

        return pendingMountedCalls;
    }

    unmount(): Component<N> {
        if (this.parent) {
            throw new Error('can only explicitly unmount root components (not already inserted in a tree)');
        }
        const stack: Component[] = [this];
        for (; ;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.mounted) {
                continue;
            }
            component.mounted = false;

            if (component.unmountListeners) {
                tvForEach(component.unmountListeners, listener => {
                    try {
                        listener.call(component);
                    } catch (e) {
                        component.injectError(e);
                    }
                    if (component.mounted) {
                        return false; // in case an unmount handler caused the tree to be (synchronously) mounted
                    }
                    return;
                });
                if (component.mounted) {
                    return this;
                }
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                stack.push(c);
            }
        }
        return this;
    }

    update(): Component<N> {
        if (updateDepth > 0) {
            pendingUpdateRoot = pendingUpdateRoot
                ? this.commonAncestor(pendingUpdateRoot)
                : this;
            return this;
        }
        updateDepth++;
        try {
            this.doUpdateWalk();
            for (let pass = 0; pendingUpdateRoot; pass++) {
                if (pass > 25) {
                    pendingUpdateRoot = null;
                    throw new Error('Update loop: did not stabilize');
                }
                const pending = pendingUpdateRoot;
                pendingUpdateRoot = null;
                pending.doUpdateWalk();
            }
        } finally {
            updateDepth--;
        }
        return this;
    }

    private static updateStack: Component[] = [];
    private doUpdateWalk(): void {
        const stack = Component.updateStack;
        stack.length = 0;
        stack.push(this);
        for (; ;) {
            const component = stack.pop();
            if (!component) {
                break;
            }
            if (!component.mounted) {
                continue;
            }
            ++touchedComponents;

            if (component.updateListeners) {
                let skipSubtree = false;
                for (const listener of component.updateListeners) {
                    updaterCount += 1;
                    try {
                        if (listener.call(component) === false) {
                            skipSubtree = true;
                            break;
                        }
                    } catch (e) {
                        component.injectError(e);
                        skipSubtree = true;
                        break;
                    }
                }
                if (skipSubtree) {
                    continue;
                }
            }

            for (let c = component.lastChild; c; c = c.prevSibling) {
                if (c.hasUpdaters) {
                    stack.push(c);
                }
            }
        }
    }

    private getChildContainerNode(): Node | null {
        if (this.node || this.detached) {
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
        let c: Component | undefined = this;
        for (; ;) {
            while (!c!.nextSibling) {
                c = c!.parent;
                if (!c || c.node) return null; // reached container — append
            }
            c = c!.nextSibling;
            const node = c!.getFirstNode();
            if (node) return node;
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

    private insertNodesInto(container: Node, beforeNode: Node | null): void {
        const node = this.node;
        if (node) {
            if (!node.parentNode) {
                // Normal case: node not yet in the DOM, insert it.
                container.insertBefore(node, beforeNode);
            } else if (node.parentNode === container) {
                // Already in the right container — inserted by a mount listener (e.g. Lazy's
                // setLazyContent) that ran during doMount after the child was linked into the
                // component tree. Position was set correctly at that time; nothing to do.
            } else {
                // Portal: this component's node is already attached to an external
                // container (the portal target). Don't move node itself; instead
                // insert this component's children into node (the target).
                //
                // Anchor subtlety: insertNodesInto is called twice on first mount —
                // once by the mount listener (appendFragment → insertBefore, which
                // freshly inserts each child into the target) and again by the caller
                // of insertBefore on this portal, which calls insertNodesInto to place
                // the portal in the outer DOM. Since the portal redirects, this second
                // call just needs to verify the children are correctly placed in the
                // target. On re-mounts the children's nodes have been removed from the
                // target, so only that second call runs and must insert fresh.
                //
                // We distinguish the two cases by checking whether the computed anchor
                // node is already inside the target: if yes, children are already in
                // place and we pass the real anchor for position verification; if no,
                // we're doing a fresh insertion and fall back to null (append in order).
                for (let c = this.firstChild; c; c = c.nextSibling) {
                    if (!c.detached) {
                        const anchor = c.getInsertionAnchor();
                        c.insertNodesInto(node, anchor?.parentNode === (node as Element) ? anchor : null);
                    }
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
            if (node.parentNode === container) {
                // Normal case: remove node from its container.
                container.removeChild(node);
            } else if (node.parentNode) {
                // Portal: node lives in an external container (the portal target).
                // Remove children from node (the target) rather than touching node itself.
                for (let c = this.firstChild; c; c = c.nextSibling) {
                    c.removeNodesFrom(node);
                }
            }
            // else: node is not in the DOM at all — nothing to remove.
        } else {
            for (let c = this.firstChild; c; c = c.nextSibling) {
                if (!c.detached) {
                    c.removeNodesFrom(container);
                }
            }
        }
    }

    // Like insertNodesInto but for components already in the DOM being moved within the
    // same container. Skips the portal case (portal nodes live in an external target and
    // aren't ours to reposition). No-ops if the node is already in the right position.
    private moveNodesInto(container: Node, beforeNode: Node | null): void {
        const node = this.node;
        if (node) {
            if (node.parentNode === container && node.nextSibling !== beforeNode) {
                container.insertBefore(node, beforeNode);
            }
            // Portal (node.parentNode !== container): don't move — children live in target.
        } else {
            for (let c = this.firstChild; c; c = c.nextSibling) {
                if (!c.detached) {
                    c.moveNodesInto(container, beforeNode);
                }
            }
        }
    }

    private propagateHasUpdaters(): void {
        for (let c: Component | undefined = this; c; c = c.parent) {
            if (c.hasUpdaters) break;
            c.hasUpdaters = true;
        }
    }

    private recomputeHasUpdaters(): boolean {
        if (this.updateListeners) return true;
        for (let c = this.firstChild; c; c = c.nextSibling) {
            if (c.hasUpdaters) return true;
        }
        return false;
    }

    private propagateClearHasUpdaters(): void {
        for (let c: Component | undefined = this; c; c = c.parent) {
            if (!c.hasUpdaters) break;
            if (c.recomputeHasUpdaters()) break;
            c.hasUpdaters = false;
        }
    }

    private addSuspenseCount(diff: number): void {
        for (let c: Component | undefined = this; c; c = c.parent) {
            c.suspenseCount += diff;
            if (c.suspenseHandler) {
                try {
                    c.suspenseHandler.call(c, c.suspenseCount);
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
        // we don't care that this componentTreeSize traverses the whole tree, as this is debug code we can delete at any time
        console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'of', componentTreeSize(root), 'components. Time:', (t1 - t0).toFixed(2), 'ms');
    }

    // Reusable buffers for replaceChildren. Safe because replaceChildren is never
    // re-entrant: update() serializes all update listeners sequentially.
    private static keptChildren: Component[] = new Array(1024);
    private static lisTails: number[] = new Array(1024);
    private static lisPrev: Int32Array = new Int32Array(1024);

    // Computes the LIS of keptChildren (keyed by .reconcileIdx) and marks stable
    // elements with reconcileIdx = -2. Uses reusable buffers to avoid per-call
    // allocation; after the first call lisPrev amortizes to zero allocations.
    private static markStableLIS(keptChildren: Component[]): void {
        const n = keptChildren.length;
        if (Component.lisPrev.length < n) {
            Component.lisPrev = new Int32Array(Math.max(n, Component.lisPrev.length * 2 || 8));
        }
        const prev = Component.lisPrev;
        for (let i = 0; i < n; i++) prev[i] = -1;

        const tails = Component.lisTails;
        tails.length = 0;
        for (let i = 0; i < n; i++) {
            const val = keptChildren[i]!.reconcileIdx;
            let lo = 0, hi = tails.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (keptChildren[tails[mid]!]!.reconcileIdx < val) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            if (lo > 0) prev[i] = tails[lo - 1]!;
            tails[lo] = i;
        }

        // Reconstruct and mark stable directly — no result array needed
        let idx = tails[tails.length - 1]!;
        while (idx >= 0) {
            keptChildren[idx]!.reconcileIdx = -2;
            idx = prev[idx]!;
        }
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


function visitFragment(fragment: FragmentItem, text: string, thisRef: unknown, handler: (this: unknown, component: Component) => void): string {
    if (fragment === null) {
        return text;
    }
    switch (typeof fragment) {
        case 'boolean':
        case 'number':
        case 'string':
            text += fragment.toString();
            return text;
        case 'undefined':
            return text;
        case 'function':
            if (text) {
                handler.call(thisRef, StaticText(text));
            }
            handler.call(thisRef, DynamicText(fragment));
            return '';
        default:
            if (fragment instanceof Observable) {
                if (text) handler.call(thisRef, StaticText(text));
                handler.call(thisRef, DynamicText(fragment));
                return '';
            } else if (fragment instanceof Component) {
                if (text) {
                    handler.call(thisRef, StaticText(text));
                }
                handler.call(thisRef, fragment);
                return '';
            } else if (Array.isArray(fragment)) {
                for (const item of fragment) {
                    text = visitFragment(item, text, thisRef, handler);
                }
                return text;
            } else {
                throw new Error(`unexpected fragment object: ${fragment}`);
            }
    }
}

export function iterateFragment(rootFragment: FragmentItem, thisRef: unknown, handler: (this: unknown, component: Component) => void): void {
    const text = visitFragment(rootFragment, '', thisRef, handler);
    if (text) {
        handler.call(thisRef, StaticText(text));
    }
}

export function flattenFragment(fragment: FragmentItem): Component[] {
    const components: Component[] = [];
    iterateFragment(fragment, components, components.push);
    return components;
}



export const HTML = new Proxy({}, {
    get(target, name) {
        const tag = name.toString();

        return function createHtmlComponent() {
            const component = new Component(document.createElement(tag));

            if (arguments.length > 0) {
                let text = '';

                for (let i = 0; i < arguments.length; ++i) {
                    const arg = arguments[i];
                    if (isPlainObject(arg)) {
                        component.setAttributes(arg);
                    } else {
                        text = visitFragment(arg, text, component, component.insertBefore);
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


const globalCssRefs = new Map<string, { style: HTMLStyleElement; count: number }>();

export function GlobalCss(cssText: string): Component<null> {
    return new Component(null, 'GlobalCss')
        .addMountedListener(function () {
            let entry = globalCssRefs.get(cssText);
            if (!entry) {
                const style = document.createElement('style');
                style.textContent = cssText;
                document.head.appendChild(style);
                entry = { style, count: 0 };
                globalCssRefs.set(cssText, entry);
            }
            entry.count++;
        })
        .addUnmountListener(function () {
            const entry = globalCssRefs.get(cssText);
            if (entry && --entry.count === 0) {
                entry.style.remove();
                globalCssRefs.delete(cssText);
            }
        });
}


export function With<T>(value: Value<T>, mapper: (v: T) => FragmentItem, name?: string): Component<null> {
    return new Component(null, name ?? 'With').addValueWatcher(value, function evalWith(v) {
        this.replaceChildren(flattenFragment(mapper(v)));
    });
}

export function If(condValue: Value<unknown>, thenFragment: FragmentItem, elseFragment?: FragmentItem): Component<null> {
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

export function When(condValue: Value<unknown>, ...bodyFragment: FragmentItem[]): Component<null> {
    let bodyComponents: Component[] | undefined;
    let active = false;
    return new Component(null, 'When').addValueWatcher(condValue, function evalWhen(v) {
        if (v) {
            if (!active) {
                this.appendChildren(bodyComponents ??= flattenFragment(bodyFragment));
                active = true;
            }
        } else {
            if (active) {
                this.clear();
                active = false;
            }
        }
    });
}

export function Unless(condValue: Value<unknown>, ...bodyFragment: FragmentItem[]): Component<null> {
    let bodyComponents: Component[] | undefined;
    let active = false;
    return new Component(null, 'Unless').addValueWatcher(condValue, function evalUnless(v) {
        if (v) {
            if (active) {
                this.clear();
                active = false;
            }
        } else {
            if (!active) {
                this.appendChildren(bodyComponents ??= flattenFragment(bodyFragment));
                active = true;
            }
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

export function For<T extends object>(items: ReadonlyArray<T>, renderFunc: (item: T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null>;
export function For<T extends object>(items: () => ReadonlyArray<T>, renderFunc: (getItem: () => T) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null>;
export function For<T extends object>(items: Signal<T[]>, renderFunc: (item: SignalProxy<T>) => FragmentItem, keyFunc: (item: T) => unknown): Component<null>;
export function For<T extends object>(items: Observable<ReadonlyArray<T>>, renderFunc: (item: ObservableProxy<T>) => FragmentItem, keyFunc?: (item: T) => unknown): Component<null>;
export function For<T extends object>(itemsValue: Value<ReadonlyArray<T>>, renderFunc: ((item: T) => FragmentItem) | ((getItem: () => T) => FragmentItem) | ((item: SignalProxy<T>) => FragmentItem) | ((item: ObservableProxy<T>) => FragmentItem), keyFunc?: (item: T) => unknown): Component<null> {
    const keyOf = keyFunc ?? (item => item);
    if (isStaticValue(itemsValue)) {
        if (keyFunc) {
            return forDirectKeyed(itemsValue, renderFunc as (item: T) => FragmentItem, keyFunc);
        }
        return forDirect(itemsValue, renderFunc as (item: T) => FragmentItem);
    } else if (itemsValue instanceof Signal) {
        return forSignal(itemsValue, renderFunc as (item: SignalProxy<T>) => FragmentItem, keyOf);
    } else if (itemsValue instanceof Observable) {
        return forObservable(itemsValue, renderFunc as (item: ObservableProxy<T>) => FragmentItem, keyOf);
    } else {
        return forThunk(itemsValue, renderFunc as (getItem: () => T) => FragmentItem, keyOf);
    }
}


// Reusable buffer for For reconciliation — safe because doUpdateWalk is non-reentrant
// (updateDepth guards against re-entry) so at most one For listener executes at a time.
const forChildrenBuffer: Component[] = [];

function forDirect<T extends object>(items: ReadonlyArray<T>, renderFunc: (item: T) => FragmentItem): Component<null> {
    let fragmentMap = new Map<unknown, Component[]>();

    return new Component<null>(null, 'For').addValueWatcher(() => items, function onForItemsChanged(arr) {
        // Fast path: check live children match arr by identity, no lambda needed.
        let c: Component | undefined = this.getFirstChild();
        let match = true;
        outer: for (const item of arr) {
            const frag = fragmentMap.get(item);
            if (!frag) { match = false; break; }
            for (const child of frag) {
                if (child !== c) { match = false; break outer; }
                c = c!.getNextSibling();
            }
        }
        if (match && c === undefined) return;
        // Structural change: full reconciliation
        const newFragmentMap = new Map<unknown, Component[]>();
        forChildrenBuffer.length = 0;
        for (const item of arr) {
            const fragment = fragmentMap.get(item) ?? flattenFragment(renderFunc(item));
            newFragmentMap.set(item, fragment);
            for (const c of fragment) forChildrenBuffer.push(c);
        }
        fragmentMap = newFragmentMap;
        this.replaceChildren(forChildrenBuffer);
    }, false);
}

function forDirectKeyed<T extends object>(items: ReadonlyArray<T>, renderFunc: (item: T) => FragmentItem, keyOf: (item: T) => unknown): Component<null> {
    let itemByKey = new Map<unknown, T>();
    let fragmentMap = new Map<unknown, Component[]>();
    const lastKeys: unknown[] = [];
    const lastItems: T[] = [];

    return new Component<null>(null, 'For').addValueWatcher(() => items, function onForItemsChanged(arr) {
        // Fast path: same item references in same key order — zero writes.
        if (arr.length === lastItems.length) {
            let same = true;
            for (let i = 0; i < arr.length; ++i) {
                if (arr[i] !== lastItems[i] || keyOf(arr[i]!) !== lastKeys[i]) { same = false; break; }
            }
            if (same) return;
        }
        // Structural change: full reconciliation
        const newItemByKey = new Map<unknown, T>();
        const newFragmentMap = new Map<unknown, Component[]>();
        lastKeys.length = 0;
        lastItems.length = 0;
        forChildrenBuffer.length = 0;
        for (const item of arr) {
            const key = keyOf(item);
            newItemByKey.set(key, item);
            lastKeys.push(key);
            lastItems.push(item);
            // Reuse fragment only when same item reference (mutable, not swapped out).
            const fragment = itemByKey.get(key) === item
                ? fragmentMap.get(key)!
                : flattenFragment(renderFunc(item));
            newFragmentMap.set(key, fragment);
            for (const c of fragment) forChildrenBuffer.push(c);
        }
        itemByKey = newItemByKey;
        fragmentMap = newFragmentMap;
        this.replaceChildren(forChildrenBuffer);
    }, false);
}

function forThunk<T extends object>(itemsValue: () => ReadonlyArray<T>, renderFunc: (getItem: () => T) => FragmentItem, keyOf: (item: T) => unknown): Component<null> {
    const itemsByKey = new Map<unknown, T>();
    let fragmentMap = new Map<unknown, Component[]>();
    const lastKeys: unknown[] = [];
    const lastItems: T[] = [];

    return new Component<null>(null, 'For').addValueWatcher(itemsValue, function onForItemsChanged(items) {
        // Fast path: zero writes. When items[i] === lastItems[i], itemsByKey is already
        // correct (same object). When a reference changes, we fall through and update.
        if (items.length === lastItems.length) {
            let same = true;
            for (let i = 0; i < items.length; ++i) {
                if (items[i] !== lastItems[i] || keyOf(items[i]!) !== lastKeys[i]) { same = false; break; }
            }
            if (same) return;
        }
        // Structural change: full reconciliation
        itemsByKey.clear();
        const newFragmentMap = new Map<unknown, Component[]>();
        lastKeys.length = 0;
        lastItems.length = 0;
        forChildrenBuffer.length = 0;
        for (const item of items) {
            const key = keyOf(item);
            itemsByKey.set(key, item);
            lastKeys.push(key);
            lastItems.push(item);
            const fragment = fragmentMap.get(key) ?? flattenFragment(renderFunc(() => {
                const item = itemsByKey.get(key);
                if (item === undefined) throw new Error('missing item in For itemsByKey');
                return item;
            }));
            newFragmentMap.set(key, fragment);
            for (const c of fragment) forChildrenBuffer.push(c);
        }
        fragmentMap = newFragmentMap;
        this.replaceChildren(forChildrenBuffer);
    }, false);
}

function forSignal<T extends object>(itemsValue: Signal<ReadonlyArray<T>>, renderFunc: (item: SignalProxy<T>) => FragmentItem, keyOf: (item: T) => unknown): Component<null> {
    const signalByKey = new Map<unknown, Signal<T>>();
    let fragmentMap = new Map<unknown, Component[]>();

    return new Component<null>(null, 'For').addValueWatcher(itemsValue, function onForItemsChanged(items) {
        // Fast path: structure unchanged — update inner signals, proxy effects propagate.
        let c: Component | undefined = this.getFirstChild();
        let match = true;
        outer: for (const item of items) {
            const frag = fragmentMap.get(keyOf(item));
            if (!frag) { match = false; break; }
            for (const child of frag) {
                if (child !== c) { match = false; break outer; }
                c = c!.getNextSibling();
            }
        }
        if (match && c === undefined) {
            for (const item of items) {
                const sig = signalByKey.get(keyOf(item))!;
                if (sig.get() !== item) sig.set(item);
            }
            return;
        }
        // Structural change: full reconciliation.
        // Cannot use forChildrenBuffer here: this listener fires via effect.activate() during
        // mount, so a nested For's activation inside insertBefore → doMount would clobber it.
        const newFragmentMap = new Map<unknown, Component[]>();
        const children: Component[] = [];
        for (const item of items) {
            const key = keyOf(item);
            let fragment = fragmentMap.get(key);
            if (!fragment) {
                const inner = new Signal(item);
                // Writes from the render function route back through the root Signal.
                const delegated = new DelegatedSignal(inner, f => {
                    const newItem = f(inner.get());
                    itemsValue.modify(arr => arr.map(i => keyOf(i) === key ? newItem : i));
                    return newItem;
                });
                signalByKey.set(key, inner);
                fragment = flattenFragment(renderFunc(signalProxy(delegated)));
            } else {
                const sig = signalByKey.get(key)!;
                if (sig.get() !== item) sig.set(item);
            }
            newFragmentMap.set(key, fragment);
            for (const c of fragment) children.push(c);
        }
        for (const key of signalByKey.keys()) {
            if (!newFragmentMap.has(key)) signalByKey.delete(key);
        }
        fragmentMap = newFragmentMap;
        this.replaceChildren(children);
    }, false);
}

function forObservable<T extends object>(itemsValue: Observable<ReadonlyArray<T>>, renderFunc: (item: ObservableProxy<T>) => FragmentItem, keyOf: (item: T) => unknown): Component<null> {
    const signalByKey = new Map<unknown, Signal<T>>();
    let fragmentMap = new Map<unknown, Component[]>();

    return new Component<null>(null, 'For').addValueWatcher(itemsValue, function onForItemsChanged(items) {
        // Fast path: structure unchanged — only item values may have changed.
        // Update signals directly; per-item proxy effects handle any DOM updates.
        let c: Component | undefined = this.getFirstChild();
        let match = true;
        outer: for (const item of items) {
            const frag = fragmentMap.get(keyOf(item));
            if (!frag) { match = false; break; }
            for (const child of frag) {
                if (child !== c) { match = false; break outer; }
                c = c!.getNextSibling();
            }
        }
        if (match && c === undefined) {
            for (const item of items) {
                const sig = signalByKey.get(keyOf(item))!;
                if (sig.get() !== item) sig.set(item);
            }
            return;
        }
        // Structural change: full reconciliation.
        // Cannot use forChildrenBuffer here: this listener fires via effect.activate() during
        // mount, so a nested For's activation inside insertBefore → doMount would clobber it.
        const newFragmentMap = new Map<unknown, Component[]>();
        const children: Component[] = [];
        for (const item of items) {
            const key = keyOf(item);
            let fragment = fragmentMap.get(key);
            if (!fragment) {
                const sig = new Signal(item);
                signalByKey.set(key, sig);
                fragment = flattenFragment(renderFunc(observableProxy(sig)));
            } else {
                const sig = signalByKey.get(key)!;
                if (sig.get() !== item) sig.set(item);
            }
            newFragmentMap.set(key, fragment);
            for (const c of fragment) children.push(c);
        }
        for (const key of signalByKey.keys()) {
            if (!newFragmentMap.has(key)) signalByKey.delete(key);
        }
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
    initContent();
    return component;

    function onError(error: unknown): boolean {
        console.error(`Error caught by ErrorBoundary: ${errorDescription(error)}`);
        try {
            const fragment = fallback.call(component, error, initContent);
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
            const fragment = body.call(component);
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

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    return new Component(null, 'Suspense').appendChildren(bodyComponents).setSuspenseHandler(function suspenseHandler(count) {
        if (count > 0) {
            if (!bodyComponents[0]!.isDetached()) {
                for (const c of bodyComponents) {
                    c.setDetached(true);
                }
                fallbackTimer = setTimeout(() => {
                    fallbackTimer = null;
                    this.appendChildren(fallbackComponents);
                }, 50);
            }
        } else {
            if (fallbackTimer !== null) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            if (bodyComponents[0]!.isDetached()) {
                if (fallbackComponents.length > 0 && fallbackComponents[0]?.getParent()) {
                    this.removeChildren(fallbackComponents);
                }
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


// Portal renders its children into `target` (an arbitrary DOM element) rather than
// into the natural parent container. The component tree remains intact so context,
// updates, and lifecycle all work normally; only DOM insertion is redirected.
//
// Implementation: Portal is a Component<Element> whose node IS the portal target.
// getChildContainerNode() already returns this.node for any non-null-node component,
// so children naturally land in target with no extra plumbing. insertNodesInto and
// removeNodesFrom detect the portal case by checking node.parentNode !== container.
//
// Content is appended lazily on first mount (not at construction time) to avoid
// inserting into the target before the portal is part of the component tree — which
// would cause detached DOM nodes and break updateRoot() traversal from inside the portal.
export function Portal(target: Element, ...content: FragmentItem[]): Component<Element> {
    return new Component<Element>(target, 'Portal')
        .addMountListener(function onPortalMount() {
            // Guard keeps content across unmount/remount cycles: children remain in the
            // component tree when the portal is unmounted (only their DOM nodes are
            // removed from target), so appendFragment must only run once.
            if (!this.getFirstChild()) this.appendFragment(content);
        });
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

export class VirtualList<T extends object> extends Component<HTMLDivElement> {
    private readonly keyOf: (item: T) => unknown;
    private readonly buffer: number;
    private readonly horizontal: boolean;
    private readonly estimateSize: number;
    private readonly itemsValue: Value<ReadonlyArray<T>>;
    private readonly renderFunc: (item: T) => FragmentItem;

    private readonly spacer: Component<HTMLDivElement>;
    private readonly wrapperMap = new Map<unknown, Component<HTMLDivElement>>();
    private readonly measuredSizes = new Map<unknown, number>();
    private readonly keyToIndex = new Map<unknown, number>();
    private readonly lastSetOffset = new Map<unknown, number>();
    private readonly wrapperToKey = new Map<Element, unknown>();
    private readonly observer: ResizeObserver;

    private visibleKeys = new Set<unknown>();
    private prevVisible = new Set<unknown>();
    private offsets = new Float64Array(0);
    private offsetsDirty = true;
    private lastItemCount = -1;
    private lastSpacerSize = -1;
    private reconcileGeneration = 0;
    private lastReconciledGeneration = -1;
    private lastItemsArray: ReadonlyArray<T> | null = null;
    private firstDirtyIndex = 0;
    private rafPending = false;
    private measuredCount = 0;
    private measuredTotal = 0;

    constructor(opts: VirtualListOptions<T>) {
        super(document.createElement('div'), 'VirtualList');
        this.keyOf = opts.key ?? (item => item as unknown);
        this.buffer = opts.buffer ?? 3;
        this.horizontal = opts.direction === 'horizontal';
        this.estimateSize = opts.estimateSize;
        this.itemsValue = opts.items;
        this.renderFunc = opts.render;

        this.node.style.overflow = 'auto';
        if (this.horizontal) this.node.style.overflowY = 'hidden';

        this.spacer = new Component(document.createElement('div'), 'VirtualList.spacer');
        this.spacer.node.style.position = 'relative';
        this.spacer.node.style.overflow = 'hidden';
        this.appendChild(this.spacer);

        this.observer = new ResizeObserver(entries => this.onResize(entries));

        this.addEventListener('scroll', () => {
            ++this.reconcileGeneration;
            this.reconcile();
        });
        this.addUpdateListener(() => this.reconcile());
        this.addMountedListener(() => { requestAnimationFrame(() => this.reconcile()); });
        this.addUnmountListener(() => this.observer.disconnect());
    }

    scrollToIndex(index: number, behavior?: ScrollBehavior): void {
        const items = getValue(this.itemsValue);
        const n = items.length;
        if (index < 0 || index >= n) return;
        if (this.firstDirtyIndex < n) {
            if (this.offsets.length < n + 1) {
                this.offsets = new Float64Array(n + 1);
                this.firstDirtyIndex = 0;
            }
            for (let i = this.firstDirtyIndex; i < n; i++) {
                this.offsets[i + 1] = this.offsets[i]! + this.sizeOf(this.keyOf(items[i]!));
            }
            this.firstDirtyIndex = n;
        }
        const offset = this.offsets[index]!;
        this.node.scrollTo({ [this.horizontal ? 'left' : 'top']: offset, behavior: behavior ?? 'auto' });
    }

    private sizeOf(key: unknown): number {
        return this.measuredSizes.get(key) ?? (this.measuredCount > 0 ? this.measuredTotal / this.measuredCount : this.estimateSize);
    }

    private onResize(entries: ResizeObserverEntry[]): void {
        let dirty = false;
        for (const entry of entries) {
            const key = this.wrapperToKey.get(entry.target);
            if (key === undefined) continue;
            const size = this.horizontal
                ? entry.borderBoxSize[0]!.inlineSize
                : entry.borderBoxSize[0]!.blockSize;
            if (size > 0 && this.measuredSizes.get(key) !== size) {
                const old = this.measuredSizes.get(key);
                if (old !== undefined) {
                    this.measuredTotal += size - old;
                } else {
                    this.measuredCount++;
                    this.measuredTotal += size;
                }
                this.measuredSizes.set(key, size);
                dirty = true;
                const idx = this.keyToIndex.get(key);
                if (idx !== undefined) {
                    this.firstDirtyIndex = Math.min(this.firstDirtyIndex, idx);
                }
            }
        }
        if (dirty) {
            this.offsetsDirty = true;
            if (!this.rafPending) {
                this.rafPending = true;
                requestAnimationFrame(() => {
                    this.rafPending = false;
                    this.reconcile();
                });
            }
        }
    }

    private reconcile(): void {
        const items = getValue(this.itemsValue);
        const n = items.length;
        const scrollPos = this.horizontal ? this.node.scrollLeft : this.node.scrollTop;
        const viewportSize = this.horizontal ? this.node.clientWidth : this.node.clientHeight;

        if (viewportSize === 0) return;

        // Skip if already reconciled this generation (avoids double reconcile from scroll + updateRoot)
        if (this.reconcileGeneration === this.lastReconciledGeneration && !this.offsetsDirty && n === this.lastItemCount && items === this.lastItemsArray) return;
        this.lastReconciledGeneration = this.reconcileGeneration;

        const itemsChanged = items !== this.lastItemsArray;
        if (itemsChanged) {
            this.keyToIndex.clear();
            for (let i = 0; i < n; i++) this.keyToIndex.set(this.keyOf(items[i]!), i);
            this.firstDirtyIndex = 0;

            for (const [key, wrapper] of this.wrapperMap) {
                if (!this.keyToIndex.has(key)) {
                    if (this.visibleKeys.has(key)) {
                        this.spacer.removeChild(wrapper);
                        this.visibleKeys.delete(key);
                    }
                    this.observer.unobserve(wrapper.node);
                    this.wrapperToKey.delete(wrapper.node);
                    const old = this.measuredSizes.get(key);
                    if (old !== undefined) {
                        this.measuredCount--;
                        this.measuredTotal -= old;
                        this.measuredSizes.delete(key);
                    }
                    this.lastSetOffset.delete(key);
                    this.wrapperMap.delete(key);
                }
            }
        }

        // Recompute cumulative offsets only when measurements or items changed
        if (this.offsetsDirty || n !== this.lastItemCount || itemsChanged) {
            if (this.offsets.length < n + 1) {
                this.offsets = new Float64Array(n + 1);
                this.firstDirtyIndex = 0;
            }
            for (let i = this.firstDirtyIndex; i < n; i++) {
                this.offsets[i + 1] = this.offsets[i]! + this.sizeOf(this.keyOf(items[i]!));
            }
            this.firstDirtyIndex = n;
            this.offsetsDirty = false;
            this.lastItemCount = n;

            const spacerSize = Math.round(this.offsets[n]!);
            if (spacerSize !== this.lastSpacerSize) {
                if (this.horizontal) {
                    this.spacer.node.style.width = spacerSize + 'px';
                    this.spacer.node.style.height = '100%';
                } else {
                    this.spacer.node.style.height = spacerSize + 'px';
                }
                this.lastSpacerSize = spacerSize;
            }
        }

        // Binary search for first visible item (first i where offsets[i+1] > scrollPos)
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.offsets[mid + 1]! <= scrollPos) lo = mid + 1;
            else hi = mid;
        }
        const firstVisible = lo;
        const start = Math.max(0, firstVisible - this.buffer);

        // Binary search for first item past viewport (first i where offsets[i] >= scrollPos + viewportSize)
        lo = firstVisible; hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.offsets[mid]! < scrollPos + viewportSize) lo = mid + 1;
            else hi = mid;
        }
        const end = Math.min(n, lo + this.buffer);

        // Reuse Set from previous reconcile
        const newVisible = this.prevVisible;
        newVisible.clear();

        for (let i = start; i < end; i++) {
            const item = items[i]!;
            const key = this.keyOf(item);
            newVisible.add(key);

            let wrapper = this.wrapperMap.get(key);
            if (!wrapper) {
                wrapper = new Component(document.createElement('div'), 'VirtualList.item');
                wrapper.node.style.position = 'absolute';
                if (this.horizontal) {
                    wrapper.node.style.top = '0';
                    wrapper.node.style.bottom = '0';
                } else {
                    wrapper.node.style.left = '0';
                    wrapper.node.style.right = '0';
                }
                wrapper.appendFragment(this.renderFunc(item));
                this.wrapperMap.set(key, wrapper);
                this.wrapperToKey.set(wrapper.node, key);
                this.observer.observe(wrapper.node);
            }

            // Reposition — skip write when offset unchanged
            const offset = this.offsets[i]!;
            if (this.lastSetOffset.get(key) !== offset) {
                wrapper.node.style.transform = this.horizontal
                    ? `translateX(${offset}px)` : `translateY(${offset}px)`;
                this.lastSetOffset.set(key, offset);
            }

            if (!this.visibleKeys.has(key)) {
                this.spacer.appendChild(wrapper);
            }
        }

        for (const key of this.visibleKeys) {
            if (!newVisible.has(key)) {
                this.spacer.removeChild(this.wrapperMap.get(key)!);
            }
        }
        this.prevVisible = this.visibleKeys;
        this.visibleKeys = newVisible;
        this.lastItemsArray = items;
    }
}
