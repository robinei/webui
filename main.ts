import { ThinVec, tvPush, tvRemove, tvLength, tvForEach, tvLast, tvPop } from './util';

type Scalar = null | undefined | string | number | boolean;

type Value<T> = T | (() => T);

type TemplateItem = Value<Scalar> | Component | TemplateItem[];

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
    component: NodeComponent;
    mountPoint: Node;
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
        root.component.update();
    }
    console.log('Ran', updaterCount, 'updaters. Touched', touchedComponents, 'and skipped', skippedComponents, 'components.');
}

abstract class Component {
    parent: Component | null = null;
    firstChild: Component | null = null;
    lastChild: Component | null = null;
    nextSibling: Component | null = null;
    prevSibling: Component | null = null;

    protected updateGuard: (() => boolean) | undefined;
    protected updateHandlers: ThinVec<() => void> = null;
    protected updateHandlerCount = 0; // count for subtree
    
    protected mounted = false;
    protected mountHandlers: ThinVec<() => void> = null;
    protected unmountHandlers: ThinVec<() => void> = null;

    setUpdateGuard(updateGuard: () => boolean): void {
        this.updateGuard = updateGuard;
    }

    private treeSize(): number {
        let count = 1;
        for (let c = this.firstChild; c; c = c.nextSibling) {
            count += c.treeSize();
        }
        return count;
    }

    protected addUpdateHandlerCount(diff: number): void {
        let c: Component | null = this;
        while (c) {
            c.updateHandlerCount += diff;
            c = c.parent;
        }
    }

    addUpdateHandler(handler: () => void): void {
        this.updateHandlers = tvPush(this.updateHandlers, handler);
        this.addUpdateHandlerCount(1);
    }

    update(): void {
        ++touchedComponents;
        if (this.updateHandlerCount === 0 || !(this.updateGuard?.() ?? true)) {
            skippedComponents += this.treeSize() - 1;
            return;
        }
        tvForEach(this.updateHandlers, (handler) => {
            updaterCount += 1;
            handler();
        });
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.update();
        }
    }

    addMountHandler(handler: () => void): void {
        this.mountHandlers = tvPush(this.mountHandlers, handler);
        if (this.mounted) {
            handler();
        }
    }

    protected doMount(): void {
        if (this.mounted) {
            throw new Error('already mounted');
        }
        this.mounted = true;
        tvForEach(this.mountHandlers, (handler) => {
            handler();
        });
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.doMount();
        }
    }

    addUnmountHandler(handler: () => void): void {
        this.unmountHandlers = tvPush(this.unmountHandlers, handler);
    }

    protected doUnmount(): void {
        if (!this.mounted) {
            throw new Error('not mounted');
        }
        this.mounted = false;
        tvForEach(this.unmountHandlers, (handler) => {
            handler();
        });
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.doUnmount();
        }
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

    private attachComponent(component: Component, before: Component | null = null): void {
        if (component === this) {
            throw new Error('cannot attach component to itself');
        }
        if (component.parent) {
            throw new Error('component is already attached to a component');
        }
        
        if (this.mounted) {
            component.update();
        }
        
        const container = this.getChildContainerNode();
        if (container) {
            component.maybeSetChildContainerNode(container);

            const referenceNode = (before ? before.getFirstNodeGoingForward() : this.getFirstNodeGoingBackward()?.nextSibling) ?? null;
            component.forEachNode((node) => {
                container.insertBefore(node, referenceNode);
            });
        }

        if (before) {
            if (before.parent !== this) {
                throw new Error('reference component not child of this component');
            }
            if (before.prevSibling) {
                before.prevSibling.nextSibling = component;
            } else {
                this.firstChild = component;
            }
            before.prevSibling = component;
            component.prevSibling = before.prevSibling;
        } else {
            if (this.lastChild) {
                this.lastChild.nextSibling = component;
            } else {
                this.firstChild = component;
            }
            component.prevSibling = this.lastChild;
            this.lastChild = component;
        }
        component.nextSibling = before;
        component.parent = this;

        this.addUpdateHandlerCount(component.updateHandlerCount);

        if (this.mounted) {
            component.doMount();
        }
    }

    private detachFromParent(): void {
        const parent = this.parent;
        if (!parent) {
            throw new Error('component is not attached to parent');
        }

        if (this.mounted) {
            this.doUnmount();
        }
        
        const container = parent.getChildContainerNode();
        if (container) {
            this.forEachNode((node) => {
                container.removeChild(node);
            });
        }

        if (this.prevSibling) {
            this.prevSibling.nextSibling = this.nextSibling;
        } else {
            parent.firstChild = this.nextSibling;
        }
        if (this.nextSibling) {
            this.nextSibling.prevSibling = this.prevSibling;
        } else {
            parent.lastChild = this.prevSibling;
        }
        this.prevSibling = null;
        this.nextSibling = null;
        this.parent = null;

        this.maybeSetChildContainerNode(null);
        parent.addUpdateHandlerCount(-this.updateHandlerCount);
    }

    appendTemplate(template: TemplateItem): void {
        if (template === null || typeof template === 'undefined') {
            // ignore
        } else if (Array.isArray(template)) {
            for (const item of template) {
                this.appendTemplate(item);
            }
        } else if (template instanceof Component) {
            this.appendChild(template);
        } else {
            this.appendChild(Txt(template));
        }
    }

    getNodes(): Node[] {
        const nodes: Node[] = [];
        this.forEachNode((node) => nodes.push(node));
        return nodes;
    }

    abstract getFirstNode(): Node | null;
    abstract getLastNode(): Node | null;
    abstract forEachNode(handler: (node: Node) => void): void;
    abstract maybeSetChildContainerNode(node: Node | null): void;
    abstract getChildContainerNode(): Node | null;

    private getFirstNodeGoingBackward(): Node | null {
        for (let c: Component | null = this; c; c = c.prevSibling) {
            const node = c.getLastNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.parent; parent instanceof FragmentComponent; parent = parent.parent) {
            for (let c: Component | null = parent.prevSibling; c; c = c.prevSibling) {
                const node = c.getLastNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    private getFirstNodeGoingForward(): Node | null {
        for (let c: Component | null = this; c; c = c.nextSibling) {
            const node = c.getFirstNode();
            if (node) {
                return node;
            }
        }
        for (let parent = this.parent; parent instanceof FragmentComponent; parent = parent.parent) {
            for (let c: Component | null = parent.nextSibling; c; c = c.nextSibling) {
                const node = c.getFirstNode();
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    appendChild(child: Component): void {
        this.attachComponent(child);
    }

    insertBefore(child: Component, reference: Component | null): void {
        this.attachComponent(child, reference);
    }

    insertAfter(child: Component, reference: Component | null): void {
        this.insertBefore(child, reference?.nextSibling ?? null);
    }

    replaceChild(replacement: Component, replaced: Component): void {
        this.attachComponent(replacement, replaced);
        replaced.detachFromParent();
    }

    removeChild(child: Component): void {
        if (child.parent !== this) {
            throw new Error('not child of this node');
        }
        child.detachFromParent();
    }

    replaceChildren(children: Component[]): void {
        this.clear();
        for (const child of children) {
            this.appendChild(child);
        }
    }

    clear(): void {
        for (;;) {
            const child = this.firstChild;
            if (!child) {
                break;
            }
            child.detachFromParent();
        }
    }
}

class FragmentComponent extends Component {
    private container: Node | null = null;

    override getFirstNode(): Node | null {
        for (let c = this.firstChild; c; c = c.nextSibling) {
            const node = c.getFirstNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    override getLastNode(): Node | null {
        for (let c = this.lastChild; c; c = c.prevSibling) {
            const node = c.getLastNode();
            if (node) {
                return node;
            }
        }
        return null;
    }

    override forEachNode(handler: (node: Node) => void): void {
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.forEachNode(handler);
        }
    }

    override maybeSetChildContainerNode(node: Node | null): void {
        this.container = node;
        for (let c = this.firstChild; c; c = c.nextSibling) {
            c.maybeSetChildContainerNode(node);
        }
    }

    override getChildContainerNode(): Node | null {
        return this.container;
    }
}

class NodeComponent<N extends Node = Node> extends Component {
    constructor(readonly node: N) {
        super();
    }

    override getFirstNode(): Node | null {
        return this.node;
    }

    override getLastNode(): Node | null {
        return this.node;
    }

    override forEachNode(handler: (node: Node) => void): void {
        handler(this.node);
    }

    override maybeSetChildContainerNode(node: Node | null): void {
        // this.node is always the container for child component nodes
    }

    override getChildContainerNode(): Node | null {
        return this.node;
    }

    mount(mountPoint: Node): void {
        if (this.mounted) {
            throw new Error('already mounted');
        }
        if (this.parent) {
            throw new Error('expected no parent component');
        }
        this.maybeSetChildContainerNode(mountPoint);
        this.update();
        this.doMount();
        mountPoint.appendChild(this.node);
        mountRoots.push({
            component: this,
            mountPoint
        });
    }

    unmount(): void {
        if (!this.mounted) {
            throw new Error('not mounted');
        }
        if (this.parent) {
            throw new Error('expected no parent component');
        }
        this.doUnmount();
        this.maybeSetChildContainerNode(null);
        for (let i = 0; i < mountRoots.length; ++i) {
            if (mountRoots[i]!.component === this) {
                mountRoots[i]!.mountPoint.removeChild(this.node);
                mountRoots.splice(i, 1);
                return;
            }
        }
        throw new Error('not among mounted components');
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
                    this.node.addEventListener(name.substring(2), (ev) => {
                        (value as EventListener)(ev);
                        updateAll();
                    });
                    break;
                }
            } else if (name === 'style') {
                if (!(this.node instanceof HTMLElement)) {
                    throw new Error('style attribute requires node to be HTMLElement');
                }
                const elem = this.node;
                const styles = value as Styles;
                for (const styleName in styles) {
                    this.addValueWatcher(styles[styleName]!, (scalar) => {
                        elem.style[styleName] = scalar;
                    });
                }
            } else {
                if (!(this.node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.node;
                this.addValueWatcher(value, (scalar) => {
                    setAttribute(elem, name, scalar);
                });
            }
        }
    }
}

function setAttribute(elem: Element, name: string, value: Scalar): void {
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


function Html<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: null | Attributes<HTMLElementTagNameMap[K]> = null,
    ...children: TemplateItem[]
): NodeComponent<HTMLElementTagNameMap[K]>  {
    const component = new NodeComponent(document.createElement(tag));
    component.appendTemplate(children);
    if (attributes) {
        component.setAttributes(attributes);
    }
    return component;
}


function Txt(value: Value<Scalar>): NodeComponent<Text> {
    const component = new NodeComponent(document.createTextNode(''));
    component.addValueWatcher(value, (scalar) => {
        component.node.nodeValue = scalar?.toString() ?? '';
    });
    return component;
}


function Fragment(...template: TemplateItem[]): FragmentComponent {
    const fragment = new FragmentComponent();
    fragment.appendTemplate(template);
    return fragment;
}


function instantiateTemplate(item: TemplateItem): Component | null {
    const fragment = new FragmentComponent();
    fragment.appendTemplate(item);
    if (!fragment.firstChild) {
        return null;
    }
    const firstChild = fragment.firstChild;
    if (!firstChild.nextSibling) {
        fragment.clear();
        return firstChild;
    }
    return fragment;
}


function With<T>(input: Value<T>, mapper: (v: T) => Component | null): Component | null {
    if (typeof input !== 'function') {
        return mapper(input);
    }
    const root = Fragment();
    const componentCache: Map<T, Component | null> = new Map();
    root.addValueWatcher(input, (v) => {
        let component = componentCache.get(v);
        if (typeof component === 'undefined') {
            component = mapper(v);
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
    thenCase: TemplateItem,
    elseCase?: TemplateItem
): Component | null {
    const thenComponent = instantiateTemplate(thenCase);
    const elseComponent = instantiateTemplate(elseCase);
    return With(predicate, (pred) => {
        return pred ? thenComponent : elseComponent;
    });
}


interface CaseEntry<T> {
    value: T | typeof NULL;
    component: Component | null;
}
function Case<T>(value: T, ...template: TemplateItem[]): CaseEntry<T> {
    const component = instantiateTemplate(template);
    return { value, component };
}
function Default<T>(...template: TemplateItem[]): CaseEntry<T> {
    const component = instantiateTemplate(template);
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


function For<T extends { key: string }>(itemsValue: Value<T[]>, itemFunc: (item: T) => NodeComponent): FragmentComponent {
    let prevItems: T[] = [];
    let components: { [key: string]: NodeComponent } = {};

    function getComponent(item: T): NodeComponent {
        let component = components[item.key];
        if (!component) {
            component = itemFunc(item);
            components[item.key] = component;
        }
        return component;
    }

    const root = Fragment();
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
    return Html('div', {
            className: 'button',
            onclick: props.onclick
        },
        Html('b', null, props.title)
    );
}




With(1, (v) => {
    switch (v) {
    case 1: return Txt("foo");
    case 2: return Txt("bar");
    default: return null;
    }
});

Switch(1,
    Case(1, "foo"),
    Case(2, "bar"),
    Default(null));


function TodoItemView(item: TodoItemModel) {
    return Html('div', {
            onclick() { item.done = !item.done; },
            style: {
                cursor: 'pointer'
            }
        },
        Html('input', {
            type: 'checkbox',
            checked: () => item.done,
            onchange(ev) {
                item.done = (ev.target as any).checked;
            }
        }),
        () => item.title,
        If(() => item.done, ' - Done', ' - Pending')
    );
}

function TodoListView(items: TodoItemModel[]) {
    const input = Html('input');
    return Html('div', null,
        'Todo:',
        Html('br'),
        input,
        Html('button', {
            onclick() {
                items.push(createTodoItem(input.node.value));
                input.node.value = '';
            }
        }, 'Add'),
        Html('br'),
        Html('button', {
            onclick() { for (const item of items) item.done = false; }
        }, 'Select none'),
        Html('button', {
            onclick() { for (const item of items) item.done = true; }
        }, 'Select all'),
        If(() => !(items.length % 2),
            'even',
            Html('span', {
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
    key: string;
}

let keyCounter = 0;
function createTodoItem(title: string): TodoItemModel {
    return {
        title,
        done: false,
        key: (++keyCounter).toString()
    };
}

const todoItems: TodoItemModel[] = [
    createTodoItem('Bake bread'),
    //createTodoItem('Sell laptop'),
];

TodoListView(todoItems).mount(document.body);
