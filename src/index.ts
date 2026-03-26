import { Component, type FragmentItem, HTML, Suspense } from './core';
import { hydrateQueryCache } from './query';
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
export const editPrefRoute = prefsRoute.subRoute('/name:string',
    async ({ name }) => (await import('./pages/prefs')).EditPreferencePage({ name }),
    { importPath: './pages/prefs' }
);

export const newsRoute = router.subRoute('/news',
    async () => (await import('./pages/news')).NewsPage(),
    { importPath: './pages/news' }
);
export const newsListRoute = newsRoute.subRoute('/',
    async () => (await import('./pages/news')).NewsListPage(),
    { importPath: './pages/news' }
);
export const newsPostRoute = newsRoute.subRoute('/id:number',
    async ({ id }) => (await import('./pages/news')).NewsPostPage({ id }),
    { importPath: './pages/news' }
);

export const newsObsRoute = router.subRoute('/news-obs',
    async () => (await import('./pages/news-obs')).NewsObsPage(),
    { importPath: './pages/news-obs' }
);
export const newsObsListRoute = newsObsRoute.subRoute('/',
    async () => (await import('./pages/news-obs')).NewsObsListPage(),
    { importPath: './pages/news-obs' }
);
export const newsObsPostRoute = newsObsRoute.subRoute('/id:number',
    async ({ id }) => (await import('./pages/news-obs')).NewsObsPostPage({ id }),
    { importPath: './pages/news-obs' }
);

export const rickRoute = router.subRoute('/rick',
    async () => (await import('./pages/rick')).RickPage(),
    { importPath: './pages/rick' }
);
export const rickListRoute = rickRoute.subRoute('/',
    async () => (await import('./pages/rick')).RickListPage(),
    { importPath: './pages/rick' }
);
export const rickCharacterRoute = rickRoute.subRoute('/id:string',
    async ({ id }) => (await import('./pages/rick')).RickCharacterPage({ id }),
    { importPath: './pages/rick' }
);

export const testsRoute = router.subRoute('/tests',
    async () => (await import('./pages/tests')).TestsPage(),
    { transient: true, importPath: './pages/tests' }
);

export const notFoundRoute = router.subRoute('/*', NotFoundPage);

if (typeof document !== 'undefined') {
const cacheEl = document.getElementById('__QUERY_CACHE__');
    if (cacheEl) { hydrateQueryCache(JSON.parse(cacheEl.textContent!)); cacheEl.remove(); }
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
            newsObsRoute.Link({}, 'News (Obs)'),
            rickRoute.Link({}, 'Rick & Morty'),
            testsRoute.Link({}, 'Tests'),
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

function NotFoundPage(): FragmentItem {
    return '404 Not Found';
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

