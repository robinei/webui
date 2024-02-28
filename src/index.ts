import { Component, FragmentItem, HTML, Suspense } from './core';
import { Router, Outlet } from './routing';

const { nav, main, button } = HTML;


const router = new Router(RootPage);

export const homeRoute = router.subRoute('/', DefaultPage);
export const testRoute = router.subRoute('/test', async () => (await import('./pages/test')).TestPage(), true);
export const todoRoute = router.subRoute('/todo', async () => (await import('./pages/todo')).TodoPage());
export const benchRoute = router.subRoute('/bench', async () => (await import('./pages/bench')).BenchmarkPage(), true);

export const prefsRoute = router.subRoute('/prefs', async () => (await import('./pages/prefs')).PreferencesPage());
export const prefListRoute = prefsRoute.subRoute('/', async () => (await import('./pages/prefs')).PreferencesListPage());
export const editPrefRoute = prefsRoute.subRoute('/name:string', async ({name}) => (await import('./pages/prefs')).EditPreferencePage({name}));

router.mount(document.body);



function RootPage(): FragmentItem {
    return [
        nav(
            testRoute.Link({}, 'Test'),
            todoRoute.Link({}, 'Todo'),
            prefsRoute.Link({}, 'Preferences'),
            benchRoute.Link({}, 'Benchmark'),
            button('Print tree', {
                onclick() {
                    console.log(dumpComponentTree(this.getRoot()));
                }
            }),
            button('Update', {
                onclick() { }
            }),
        ),
        main(Suspense('Loading...', Outlet()))
    ];
}

function DefaultPage(): FragmentItem {
    return 'Welcome!';
}

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

