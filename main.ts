import { ThinVec, tvPush, tvRemove, tvLength, tvForEach, tvLast, tvPop } from './util';

type Scalar = null | undefined | string | number | boolean;

type Value<T> = T | (() => T);

type NodeItem = Node | Component;

type TemplateItem = Value<Scalar> | NodeItem | TemplateItem[];

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

function itemNode(item: NodeItem): Node {
    return item instanceof Component ? item.node : item;
}

function nodeItemFromTemplateItem(item: TemplateItem): NodeItem | undefined {
    if (item === null) {
        return undefined;
    }
    switch (typeof item) {
    case 'undefined':
        return undefined;
    case 'string':
    case 'number':
    case 'boolean':
        return Txt(item.toString());
    case 'function':
        const textNode = Txt('');
        const component = new Component(textNode);
        component.watchValue(item, (scalar) => {
            textNode.nodeValue = scalar?.toString() ?? '';
        })
        return component;
    }
    if (Array.isArray(item)) {
        if (item.length === 0) {
            return undefined;
        }
        if (item.length === 1) {
            return nodeItemFromTemplateItem(item[0]);
        }
        return Html('span', null, ...item);
    }
    return item;
}


const myUndefined = {};

interface MountRoot {
    component: Component;
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


class Component<N extends Node = Node> {
    readonly parent: Component | undefined;
    private firstChild: Component | undefined;
    private prevSibling: Component | undefined;
    private nextSibling: Component | undefined;

    private updateGuard: (() => boolean) | undefined;
    private updateHandlers: ThinVec<() => void> = null;
    private updateHandlerCount = 0; // count for subtree
    
    private mounted = false;
    private mountHandlers: ThinVec<() => void> = null;
    private unmountHandlers: ThinVec<() => void> = null;

    constructor(readonly node: N) {}

    setUpdateGuard(updateGuard: () => boolean): Component<N> {
        this.updateGuard = updateGuard;
        return this;
    }

    private treeSize(): number {
        let count = 1;
        for (let c = this.firstChild; c; c = c.nextSibling) {
            count += c.treeSize();
        }
        return count;
    }

    private addUpdateHandlerCount(diff: number): void {
        let c: Component | undefined = this;
        while (c) {
            c.updateHandlerCount += diff;
            c = c.parent;
        }
    }

    addUpdateHandler(handler: () => void): Component<N> {
        this.updateHandlers = tvPush(this.updateHandlers, handler);
        this.addUpdateHandlerCount(1);
        return this;
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

    addMountHandler(handler: () => void): Component<N> {
        this.mountHandlers = tvPush(this.mountHandlers, handler);
        if (this.mounted) {
            handler();
        }
        return this;
    }

    mount(mountPoint: Node): void {
        if (this.mounted) {
            throw new Error('already mounted');
        }
        if (this.parent) {
            throw new Error('expected no parent component');
        }
        this.update();
        this.doMount();
        mountPoint.appendChild(this.node);
        mountRoots.push({
            component: this,
            mountPoint
        });
    }

    private doMount(): void {
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

    addUnmountHandler(handler: () => void): Component<N> {
        this.unmountHandlers = tvPush(this.unmountHandlers, handler);
        return this;
    }

    unmount(): void {
        if (!this.mounted) {
            throw new Error('not mounted');
        }
        if (this.parent) {
            throw new Error('expected no parent component');
        }
        this.doUnmount();
        for (let i = 0; i < mountRoots.length; ++i) {
            if (mountRoots[i]!.component === this) {
                mountRoots[i]!.mountPoint.removeChild(this.node);
                mountRoots.splice(i, 1);
                return;
            }
        }
        throw new Error('not among mounted components');
    }

    private doUnmount(): void {
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

    watchValue<T>(value: Value<T>, callback: (v: T) => void, checkEqual: boolean = true): void {
        if (typeof value === 'function') {
            const func = value as () => T;
            let val: T | typeof myUndefined = myUndefined;
            this.addUpdateHandler(checkEqual ? () => {
                const newVal = func();
                if (val !== newVal) {
                    val = newVal;
                    callback(newVal);
                }
            } : () => {
                callback(func());
            });
        } else {
            callback(value);
        }
    }

    private detachFromParent(): Component<N> {
        if (!this.parent) {
            throw new Error('component is not attached to parent');
        }
        if (this.mounted) {
            this.doUnmount();
        }
        const parent = this.parent;
        if (this.prevSibling) {
            this.prevSibling.nextSibling = this.nextSibling;
        } else {
            parent.firstChild = this.nextSibling;
        }
        if (this.nextSibling) {
            this.nextSibling.prevSibling = this.prevSibling;
        }
        this.prevSibling = undefined;
        this.nextSibling = undefined;
        (this as any).parent = undefined; // via any to ignore readonly
        parent.addUpdateHandlerCount(-this.updateHandlerCount);
        return this;
    }

    private attachComponent(component: Component): Component<N> {
        if (component === this) {
            throw new Error('cannot attach component to itself');
        }
        if (component.parent) {
            throw new Error('component is already attached to a component');
        }
        if (this.mounted) {
            component.update();
            component.doMount();
        }
        if (this.firstChild) {
            this.firstChild.prevSibling = component;
            component.nextSibling = this.firstChild;
        }
        this.firstChild = component;
        (component as any).parent = this; // via any to ignore readonly
        this.addUpdateHandlerCount(component.updateHandlerCount);
        return this;
    }

    appendChild(item: NodeItem): Component<N> {
        if (item instanceof Component) {
            this.attachComponent(item);
            this.node.appendChild(item.node);
        } else {
            this.node.appendChild(item);
        }
        return this;
    }

    insertBefore(item: NodeItem, reference: NodeItem): Component<N> {
        if (item instanceof Component) {
            this.attachComponent(item);
            this.node.insertBefore(item.node, itemNode(reference));
        } else {
            this.node.insertBefore(item, itemNode(reference));
        }
        return this;
    }

    replaceChild(replacement: NodeItem, toReplace: NodeItem): Component<N> {
        if (toReplace instanceof Component) {
            toReplace.detachFromParent();
        }
        if (replacement instanceof Component) {
            this.attachComponent(replacement);
        }
        this.node.replaceChild(itemNode(replacement), itemNode(toReplace));
        return this;
    }

    removeChild(item: NodeItem): Component<N> {
        if (item instanceof Component) {
            item.detachFromParent();
            this.node.removeChild(item.node);
        } else {
            this.node.removeChild(item);
        }
        return this;
    }

    clear(): Component<N> {
        while (this.firstChild) {
            this.firstChild.detachFromParent();
        }
        while (this.node.lastChild) {
            this.node.removeChild(this.node.lastChild);
        }
        return this;
    }

    appendTemplate(items: TemplateItem[]): Component<N> {
        for (const item of items) {
            if (item === null) {
                continue;
            }
    
            switch (typeof item) {
            case 'undefined':
                continue;
            case 'string':
            case 'number':
            case 'boolean':
                this.node.appendChild(document.createTextNode(item.toString()));
                continue;
            case 'function':
                const textNode = document.createTextNode('');
                this.node.appendChild(textNode);
                this.watchValue(item, (scalar) => {
                    textNode.nodeValue = scalar?.toString() ?? '';
                });
                continue;
            }

            if (Array.isArray(item)) {
                this.appendTemplate(item);
                continue;
            }

            this.appendChild(item);
        }
        return this;
    }
    
    setAttributes(attributes: Attributes<N>): Component<N> {
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
                    this.watchValue(styles[styleName]!, (scalar) => {
                        elem.style[styleName] = scalar;
                    });
                }
            } else {
                if (!(this.node instanceof Element)) {
                    throw new Error('attribute requires node to be Element');
                }
                const elem = this.node;
                this.watchValue(value, (scalar) => {
                    setAttribute(elem, name, scalar);
                });
            }
        }
        return this;
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
): Component<HTMLElementTagNameMap[K]>  {
    const component = new Component(document.createElement(tag)).appendTemplate(children);
    if (attributes) {
        component.setAttributes(attributes);
    }
    return component;
}

function Br(): Node {
    return document.createElement('br');
}

function Txt(text: string): Text {
    return document.createTextNode(text);
}

function Fragment(...children: TemplateItem[]): Component<DocumentFragment> {
    return new Component(document.createDocumentFragment()).appendTemplate(children);
}

interface ListAdapter<T> {
    readonly items: ReadonlyArray<T>;
    readonly generation?: number;
}

function List<T extends { key: string }>(itemsValue: Value<T[]>, itemFunc: (item: T) => Component): Component {
    let prevItems: T[] = [];
    let components: { [key: string]: Component } = {};

    function getComponent(item: T): Component {
        let component = components[item.key];
        if (!component) {
            component = itemFunc(item);
            components[item.key] = component;
        }
        return component;
    }

    const root = Html('span');
    const placeholder = document.createComment('placeholder');
    root.addUpdateHandler(() => {
        const items = typeof itemsValue === 'function' ? itemsValue() : itemsValue;

        if (listsEqual(prevItems, items)) {
            return;
        }

        const parent = root.parent;
        if (parent) {
            parent.replaceChild(placeholder, root);
        }

        root.clear();
        for (const item of items) {
            root.appendChild(getComponent(item));
        }

        if (parent) {
            parent.replaceChild(root, placeholder);
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

function If(
    predicate: Value<boolean>,
    thenCase: NodeItem | (() => NodeItem),
    elseCase?: NodeItem | (() => NodeItem)
): Component {
    let thenItem: NodeItem | undefined;
    let elseItem: NodeItem | undefined;

    const root = Html('span');
    root.watchValue(predicate, (pred) => {
        if (pred) {
            if (elseItem) {
                root.removeChild(elseItem);
                elseItem = undefined;
            }
            if (!thenItem) {
                thenItem = typeof thenCase === 'function' ? thenCase() : thenCase;
                root.appendChild(thenItem);
            }
        } else {
            if (thenItem) {
                root.removeChild(thenItem);
                thenItem = undefined;
            }
            if (elseCase) {
                if (!elseItem) {
                    elseItem = typeof elseCase === 'function' ? elseCase() : elseCase;
                    root.appendChild(elseItem);
                }
            }
        }
    });
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
        Html('span', null, () => item.title),
        If(() => item.done,
            Txt(' - Done'),
            Txt(' - Pending')
        )
    );
}

function TodoListView(items: TodoItemModel[]) {
    const input = Html('input').node;
    return Html('div', null,
        'Todo:',
        Br(),
        input,
        Html('button', {
            onclick() {
                items.push(createTodoItem(input.value));
                input.value = '';
            }
        }, 'Add'),
        Br(),
        Html('button', {
            onclick() { for (const item of items) item.done = false; }
        }, 'Select none'),
        Html('button', {
            onclick() { for (const item of items) item.done = true; }
        }, 'Select all'),
        If(() => !(items.length % 2),
            Txt('even'),
            Html('span', {
                onmount() {
                    console.log('mounted');
                },
                onunmount() {
                    console.log('unmounted');
                },
            }, 'odd')
        ),
        List(items, TodoItemView),
    );
}



interface TodoItemModel {
    title: string;
    done: boolean;
    key: string;
}

class TodoListModel {
    readonly items: TodoItemModel[] = [];
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
