import { Component, Html } from './core';
import { Router, Outlet, Link } from './routing';

import { PreferencesPage, EditPreferencePage, PreferencesListPage } from './pages/prefs';
import { TestPage } from './pages/test';
import { TodoPage } from './pages/todo';
import { BenchmarkPage } from './pages/bench';


const { div, button, br } = Html;

function NavBar() {
    return div(
        Link('/test', 'Test'),
        ' | ',
        Link('/todo', 'Todo'),
        ' | ',
        Link('/prefs', 'Prefs'),
        ' | ',
        Link('/bench', 'Benchmark'),
        ' | ',
        button('Print tree', {
            onclick() {
                console.log(dumpComponentTree(this.getRoot()));
            }
        }),
        ' | ',
        button('Update', {
            onclick() { }
        }),
    );
}

function RootPage() {
    return div(
        NavBar(),
        br(),
        Outlet()
    );
}

function DefaultPage() {
    return 'Welcome!';
}



const router = new Router(RootPage);
router.route('/test', TestPage);
router.route('/todo', TodoPage);
router.route('/', DefaultPage);
{
    const prefs = router.route('/prefs', PreferencesPage);
    prefs.route('/name:string', EditPreferencePage);
    prefs.route('', PreferencesListPage);
}
router.route('/bench', BenchmarkPage);
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

