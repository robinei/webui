import { errorDescription, asyncDelay } from './util';
import { Value, mapValue, newProp, Context, Component, FragmentItem,
    H, StaticText, With, If, Match, For, Repeat, Suspense, ErrorBoundary, Lazy } from './core';
import { Router } from './router';



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
        Match(() => model.getItems().length % 2,
            [0, 'even'],
            [1, StaticText('odd')
                    .addMountListener(() => console.log('odd mounted'))
                    .addUnmountListener(() => console.log('odd unmounted'))]),
        For(model.getItems, TodoItemView),
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
            const cb = H('input', { type: 'checkbox', onchange()  { /* empty event handler still triggers update */ } });
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





const root = Router();
const prefs = root.route('prefs', _ => 'preferences');
const pref = prefs.route('name:string', args => ['viewing ', args.name]);
const editPref = pref.route('edit', args => ['editing ', args.name]);
root.goto('/prefs/foo')


new Component(document.body).appendChildren([
    TodoListView(new TodoListModel().addItem('Bake bread')),
    TestComponent(),
    root.getComponent(),
]).mount();



function runBenchmarks() {
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
}


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
