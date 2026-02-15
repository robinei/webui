import { Component, FragmentItem, HTML, Suspense, readEmbeddedStoreData } from './core';
import { Router, Outlet } from './routing';

const { nav, main, button } = HTML;


export const router = new Router(RootPage);

export const homeRoute = router.subRoute('/', DefaultPage);
export const testRoute = router.subRoute('/test', async () => (await import('./pages/test')).TestPage(), { transient: true, importPath: './pages/test' });
export const todoRoute = router.subRoute('/todo', async () => (await import('./pages/todo')).TodoPage(), { importPath: './pages/todo' });
export const benchRoute = router.subRoute('/bench', async () => (await import('./pages/bench')).BenchmarkPage(), { transient: true, importPath: './pages/bench' });
export const virtualRoute = router.subRoute('/virtual', async () => (await import('./pages/virtual')).VirtualListPage(), { transient: true, importPath: './pages/virtual' });

export const prefsRoute = router.subRoute('/prefs', async () => (await import('./pages/prefs')).PreferencesPage(), { importPath: './pages/prefs' });
export const prefListRoute = prefsRoute.subRoute('/', async () => (await import('./pages/prefs')).PreferencesListPage(), { importPath: './pages/prefs' });
export const editPrefRoute = prefsRoute.subRoute('/name:string', async ({ name }) => (await import('./pages/prefs')).EditPreferencePage({ name }), { importPath: './pages/prefs' });

export const newsRoute = router.subRoute('/news',
    async () => (await import('./pages/news')).NewsPage(),
    { importPath: './pages/news' }
);
export const newsListRoute = newsRoute.subRoute('/',
    async () => (await import('./pages/news')).NewsListPage(),
    {
        importPath: './pages/news',
        initStores: async () => (await import('./pages/news')).initStores()
    }
);
export const newsPostRoute = newsRoute.subRoute('/id:number',
    async ({ id }) => (await import('./pages/news')).NewsPostPage({ id }),
    {
        importPath: './pages/news',
        initStores: async (args) => (await import('./pages/news')).initPostStores(args.id as number)
    }
);

if (typeof document !== 'undefined') {
    readEmbeddedStoreData();
    router.mount(document.body);
}



function RootPage(): FragmentItem {
    return [
        nav(
            testRoute.Link({}, 'Test'),
            todoRoute.Link({}, 'Todo'),
            prefsRoute.Link({}, 'Preferences'),
            benchRoute.Link({}, 'Benchmark'),
            virtualRoute.Link({}, 'Virtual List'),
            newsRoute.Link({}, 'News'),
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

