class FakeNode {
    parentNode: FakeNode | null = null;
    nextSibling: FakeNode | null = null;
    textContent = '';
    nodeValue: string | null = null;
    nodeType = 1;
    private children: FakeNode[] = [];

    insertBefore(child: FakeNode, ref: FakeNode | null): FakeNode {
        child.parentNode = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i >= 0) {
            if (i > 0) this.children[i - 1]!.nextSibling = child;
            this.children.splice(i, 0, child);
        } else {
            if (this.children.length > 0) this.children[this.children.length - 1]!.nextSibling = child;
            this.children.push(child);
        }
        child.nextSibling = ref ?? null;
        return child;
    }

    removeChild(child: FakeNode): FakeNode {
        const i = this.children.indexOf(child);
        if (i >= 0) {
            if (i > 0) this.children[i - 1]!.nextSibling = child.nextSibling;
            this.children.splice(i, 1);
        }
        child.parentNode = null;
        child.nextSibling = null;
        return child;
    }

    appendChild(child: FakeNode) { return this.insertBefore(child, null); }
    addEventListener() {}
    removeEventListener() {}
}

// Node → Element → HTMLElement mirrors the real DOM hierarchy
class FakeElement extends FakeNode {
    setAttribute() {}
    removeAttribute() {}
}

class FakeHTMLElement extends FakeElement {
    style = new Proxy({} as Record<string, string>, { set: () => true });
}

class FakeText extends FakeNode {
    override nodeType = 3;
    constructor(value: string) { super(); this.nodeValue = value; this.textContent = value; }
}

const fakeHistory = { replaceState() {}, pushState() {}, go() {} };
const fakeWindow = { addEventListener() {}, removeEventListener() {}, scrollTo() {}, history: fakeHistory };
const fakeLocation = { pathname: '/', search: '', href: '/' };
const fakeDocument = {
    createElement: (_tag: string) => new FakeHTMLElement(),
    createTextNode: (text: string) => new FakeText(text),
    getElementById: (_id: string): null => null,
    head: new FakeHTMLElement(),
    body: new FakeHTMLElement(),
    location: fakeLocation,
};

export function installFakeDOM(): void {
    const g = globalThis as any;
    g.document = fakeDocument;
    g.location = fakeLocation;
    g.history = fakeHistory;
    g.window = fakeWindow;
    g.ResizeObserver = class { observe() {} disconnect() {} };
    g.requestAnimationFrame = () => {};
    g.PopStateEvent = class PopStateEvent {};
    g.Event = class Event {};
    g.Node = FakeNode;
    g.Element = FakeElement;
    g.HTMLElement = FakeHTMLElement;
    g.Text = FakeText;
}

// Call synchronously before cloned.mount() with no await between — JS single-threading
// ensures no other request interleaves and reads location in between.
export function setFakeLocation(pathname: string, search: string): void {
    fakeLocation.pathname = pathname;
    fakeLocation.search = search;
    fakeLocation.href = pathname + search;
}
