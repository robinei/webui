import { Component, H } from './core';
import { Router, Outlet, Link } from './routing';

import { PreferencesPage, EditPreferencePage, PreferencesListPage } from './pages/prefs';
import { TestPage } from './pages/test';
import { TodoPage } from './pages/todo';


function NavBar() {
    return H('div', null,
        Link('/test', 'Test'),
        ' | ',
        Link('/todo', 'Todo'),
        ' | ',
        Link('/prefs', 'Prefs'),
        ' | ',
        H('button', {
            onclick() {
                console.log(dumpComponentTree(this.getRoot()));
            }
        }, 'Print tree'),
        ' | ',
        H('button', {
            onclick() {}
        }, 'Update')
    );
}

function RootPage() {
    return H('div', null,
        NavBar(),
        H('br'),
        Outlet()
    );
}

function DefaultPage() {
    return 'Welcome!';
}



const router = new Router(RootPage);
{
    router.route('/test', TestPage);
    
    router.route('/todo', TodoPage);

    router.route('/', DefaultPage);

    const prefs = router.route('/prefs', PreferencesPage);
    {
        prefs.route('/name:string', EditPreferencePage);
        prefs.route('', PreferencesListPage);
    }
}
router.init();

new Component(document.body)
    .appendChild(router.component)
    .mount();





function dumpComponentTree(root: Component): string {
    const result: string[] = [];
    dumpComponent(root, 0);
    return result.join('');
    
    function dumpComponent(component: Component, depth: number) {
        for (let i = 0; i < depth; ++i) {
            result.push('  ');
        }
        if (component.node instanceof Text) {
            result.push(JSON.stringify(component.node.nodeValue));
        } else if (!component.hasChildren() && component.node?.textContent) {
            result.push(component.getName());
            result.push(' ');
            result.push(JSON.stringify(component.node.textContent));
        } else {
            result.push(component.getName());
        }
        result.push('\n');
        component.forEachChild(c => dumpComponent(c, depth + 1));
    }
}


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
}
runBenchmarks();
