import { Component, Context, FragmentItem, HTML, HTMLChildFragment, hasStoreHydrationData, setStoreHydrationData } from './core';
import { deepEqual } from './util';

const { a } = HTML;


type ParseUrlSpec<P extends string> =
    P extends `${infer Prefix extends string}/${infer Rest extends string}`
        ? ParseUrlSpecTypedKey<Prefix> & ParseUrlSpec<Rest>
        : ParseUrlSpecSuffix<P>;

type ParseUrlSpecSuffix<S extends string> =
    S extends `${infer Prefix extends string}?${infer Query extends string}`
        ? ParseUrlSpecTypedKey<Prefix> & Partial<ParseUrlSpecQuery<Query>>
        : ParseUrlSpecTypedKey<S>;

type ParseUrlSpecQuery<Q extends string> =
    Q extends `${infer Prefix extends string}&${infer Rest extends string}`
        ? ParseUrlSpecTypedKey<Prefix> & ParseUrlSpecQuery<Rest>
        : ParseUrlSpecTypedKey<Q>;

type ParseUrlSpecTypedKey<S extends string> =
    S extends `${infer Key extends string}:${infer Type extends string}`
        ? { [_ in Key]: ParseUrlSpecType<Type> }
        : {};

type ParseUrlSpecType<S extends string> =
    S extends 'string' ? string :
    S extends 'number' ? number :
    S extends 'boolean' ? boolean : unknown;

type FunctionsOf<T> = {
    [K in keyof T]-?: () => T[K];
};


type Test = FunctionsOf<ParseUrlSpec<'/hello/foo:string/test/bar:number/asdf?arg:boolean&arg2:number'>>;
const test: Test = {} as any;



type UrlMatcher = (url: string, args: { [key: string]: unknown }) => string | false;

function parseUrlSpec(spec: string): UrlMatcher {
    if (spec === '') {
        return (url, _) => url;
    }

    if (spec.startsWith('/')) {
        const parseRest = parseUrlSpec(spec.substring(1));
        return function parseSlash(url, args) {
            if (url.startsWith('/')) {
                return parseRest(url.substring(1), args);
            }
            if (url.startsWith('?') || url === '') {
                return parseRest(url, args);
            }
            return false;
        };
    }

    if (spec.startsWith('?')) {
        if (spec.indexOf('/') >= 0) {
            throw new Error('found / in query spec: ' + spec);
        }
        const queryParsers: { [key: string]: (s: string) => unknown } = {};
        for (const specPart of spec.substring(1).split('&')) {
            const [key, type] = specPart.split(':');
            if (!key || !type) {
                throw new Error('bad query spec');
            }
            queryParsers[key] = createValueParser(type, true);
        }
        return function parseQuery(url, args) {
            if (url.indexOf('/') >= 0) {
                return false;
            }
            if (url.startsWith('?')) {
                const query: { [key: string]: string } = {};
                for (const queryPart of url.substring(1).split('&')) {
                    const [key, value] = queryPart.split('=');
                    if (key && value) {
                        query[key] = value;
                    } else if (key) {
                        query[key] = '';
                    }
                }
                for (const key in queryParsers) {
                    const value = query[key];
                    if (value !== undefined) {
                        const parsedValue = queryParsers[key]!(value);
                        if (parsedValue !== null) {
                            args[key] = parsedValue;
                        }
                    }
                }
            } else if (url) {
                return false;
            }
            return '';
        };
    }

    let partEnd = spec.indexOf('/');
    if (partEnd < 0) {
        partEnd = spec.indexOf('?');
        if (partEnd < 0) {
            partEnd = spec.length;
        }
    }
    const fragment = spec.substring(0, partEnd);
    const parseRest = parseUrlSpec(spec.substring(partEnd));
    const splitFrag = fragment.split(':');

    if (splitFrag.length === 1) {
        // no ':' in fragment; match verbatim
        return function parsePathComponent(url, args) {
            if (url.startsWith(fragment)) {
                return parseRest(url.substring(fragment.length), args);
            }
            return false;
        };
    }

    if (splitFrag.length !== 2) {
        throw new Error(`bad url spec fragment: ${fragment}`);
    }

    // fragment has form '<key>:<type>', like 'category:string', and must be parsed as a value of the specified type
    const [key, type] = splitFrag;
    if (!key || !type) {
        throw new Error(`bad url spec fragment: ${fragment}`);
    }

    const parser = createValueParser(type);

    return function parseValue(url, args) {
        const i = url.indexOf('/');
        const prefix = url.substring(0, i < 0 ? url.length : i);
        const value = parser(prefix);
        if (value !== null) {
            args[key] = value;
            return parseRest(url.substring(prefix.length), args);
        }
        return false;
    };
}

function createValueParser(type: string, allowEmpty: boolean = false): (s: string) => unknown {
    switch (type) {
        case 'string': return function parseString(s) {
            return !allowEmpty && !s ? null : s;
        };
        case 'number': return function parseNumber(s) {
            if (!allowEmpty && !s) {
                return null;
            }
            const num = Number(s);
            return isNaN(num) ? null : num;
        };
        case 'boolean': return function parseBoolean(s) {
            switch (s.toLowerCase()) {
                case '0':
                case 'no':
                case 'false': return false;
                case '1':
                case 'yes':
                case 'true': return true;
                case '': return allowEmpty ? true : null;
                default: return null;
            }
        };
        default: throw new Error(`unknown type '${type}' in url spec`);
    }
}



function runParseUrlSpecTests() {
    runTest('/', '/', '', {});
    runTest('/', '/foo', 'foo', {});
    runTest('/foo', '/foo', '', {});
    runTest('/foo:number', '/123', '', {foo: 123});
    runTest('/foo:number', '/nan', false, {});
    runTest('/foo:number/bar:string', '/123/str', '', {foo: 123, bar: 'str'});
    runTest('/prefix/foo:number/bar:string', '/prefix/123/str', '', {foo: 123, bar: 'str'});
    runTest('/foo?b:boolean&n:number&s:string', '/foo?b=true&n=123&s=bar', '', {b:true, n:123, s:'bar'});
    runTest('/foo?b:boolean&n:number&s:string', '/foo?b=true', '', {b:true});
    runTest('/foo?b:boolean&n:number&s:string', '/foo?b&n&s', '', {b:true, n:0, s:''});
    runTest('/foo/b:boolean', '/foo/', false, {});
    runTest('/foo/n:number', '/foo/', false, {});
    runTest('/foo/s:string', '/foo/', false, {});
    runTest('/', '', '', {});
    runTest('/?arg:number', '?arg=123', '', {arg:123});
    runTest('/foo/', '/foo', '', {});
    runTest('/foo/?arg:number', '/foo?arg=123', '', {arg:123});

    function runTest(spec: string, url: string, expectedResult: string | false, expectedArgs: { [key: string]: unknown }): void {
        const matcher = parseUrlSpec(spec);
        const args: { [key: string]: unknown } = {};
        const result = matcher(url, args);
        console.assert(result === expectedResult);
        console.assert(deepEqual(args, expectedArgs));
    }
}
runParseUrlSpecTests();



const RouteContext = new Context<Route<unknown>>('RouteContext');

export function Outlet() {
    const component = new Component(null, 'Outlet');

    component.addMountedListener(function onMountedOutlet() {
        const route = component.getContext(RouteContext);
        (route as any).setOutlet(component);
    });
    
    return component;
}


// TODO: Parallel data loading — when parent + child both have initStores, the client-side
//   path waterfalls (parent fetches → renders → mounts Outlet → child fetches). Should kick
//   off all matched loaders simultaneously like React Router / TanStack Router.
// TODO: Prefetching on intent — preload route code/data on link hover or viewport intersection.
//   importPath and initStores per route already provide the pieces needed.
// TODO: Scroll restoration — remember scroll position on back-navigation. Needs
//   scrollRestoration: 'manual' + position cache keyed by history entry.
// TODO: Navigation blocking — "unsaved changes" guards for SPA navigation (beforeunload
//   only covers tab close).
// TODO: 404 / catch-all routes — wildcard fallback for unmatched URLs instead of silent
//   redirect to /.

export type RouteOptions = {
    transient?: boolean;
    importPath?: string;
    initStores?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export class Route<Args> {
    private readonly subRoutes: Route<unknown>[] = [];
    private readonly matcher: UrlMatcher;
    private contentAppended = false;

    private args?: { [key: string]: unknown };

    private matchedSubRoute?: Route<unknown>;
    private outletSubRoute?: Route<unknown>; // the sub-route whose component we have currently mounted in our fragment's Outlet
    protected outlet?: Component;

    protected readonly component: Component<null>;
    private readonly transient?: boolean;
    private readonly importPath?: string;
    private readonly initStoresFn?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

    protected constructor(
        private readonly parent: Route<unknown> | null,
        private readonly urlSpec: string,
        private readonly makeContent: (args: any) => FragmentItem | Promise<FragmentItem>,
        options?: RouteOptions
    ) {
        this.matcher = parseUrlSpec(urlSpec);
        this.transient = options?.transient;
        this.importPath = options?.importPath;
        this.initStoresFn = options?.initStores;
        const name = urlSpec ? `Route[${urlSpec}]` : 'Router';
        this.component = new Component(null, name).provideContext(RouteContext, this);
    }

    subRoute<UrlSpec extends string, ChildArgs = Args & ParseUrlSpec<UrlSpec>>(
        urlSpec: UrlSpec,
        makeContent: (args: FunctionsOf<ChildArgs>) => FragmentItem | Promise<FragmentItem>,
        options?: RouteOptions
    ): Route<ChildArgs> {
        if (!urlSpec.startsWith('/')) {
            throw new Error('URL spec must start with /');
        }
        const route = new Route<ChildArgs>(this, urlSpec, makeContent, options);
        this.subRoutes.push(route);
        return route;
    }

    getMatchedChunks(): string[] {
        const chunks: string[] = [];
        if (this.importPath) {
            chunks.push(this.importPath);
        }
        if (this.matchedSubRoute) {
            chunks.push(...this.matchedSubRoute.getMatchedChunks());
        }
        return chunks;
    }

    getMatchedInitStores(): Array<() => Promise<Record<string, unknown>>> {
        const fns: Array<() => Promise<Record<string, unknown>>> = [];
        if (this.initStoresFn) {
            const args = { ...this.args };
            const fn = this.initStoresFn;
            fns.push(() => fn(args));
        }
        if (this.matchedSubRoute) fns.push(...this.matchedSubRoute.getMatchedInitStores());
        return fns;
    }

    Link(args: Args, ...fragment: HTMLChildFragment<HTMLAnchorElement>[]) {
        return Link(this.getUrl(args), ...fragment);
    }

    push(args: Args): void {
        this.component.getContext(RouterContext).pushUrl(this.getUrl(args));
    }

    replace(args: Args): void {
        this.component.getContext(RouterContext).replaceUrl(this.getUrl(args));
    }

    getUrl(args: Args): string {
        const remainingArgs = { ...args as { [key: string]: unknown } };
        let url = this.getPath(remainingArgs);
        let hasQuery = false;
        for (const key in remainingArgs) {
            const arg = encodeURIComponent(remainingArgs[key]!.toString());
            url = hasQuery ? `${url}&${key}=${arg}` : `${url}?${key}=${arg}`;
            hasQuery = true;
        }
        return url;
    }

    private getPath(remainingArgs: { [key: string]: unknown }): string {
        return (this.parent?.getPath(remainingArgs) ?? '') + this.getOwnPath(remainingArgs);
    }

    private getOwnPath(remainingArgs: { [key: string]: unknown }): string {
        let path = this.urlSpec;
        const queryIndex = this.urlSpec.indexOf('?');
        if (queryIndex >= 0) {
            path = path.substring(0, queryIndex);
        }
        const parts = path.split('/');
        for (let i = 0; i < parts.length; ++i) {
            const temp = parts[i]!.split(':');
            if (temp.length === 2) {
                const key = temp[0]!;
                if (remainingArgs[key] === undefined) {
                    throw new Error('missing argument: ' + key);
                }
                parts[i] = encodeURIComponent(remainingArgs[key]!.toString());
                delete remainingArgs[key];
            }
        }
        return parts.join('/');
    }

    protected tryMatch(url: string, parentArgs?: { [key: string]: unknown }): boolean {
        const args = { ...parentArgs };
        const restOfUrl = this.matcher(url, args);
        if (restOfUrl === false) {
            return false;
        }
        
        this.args = args;

        for (const route of this.subRoutes) {
            if (route.tryMatch(restOfUrl, args)) {
                this.matchedSubRoute = route;
                this.update();
                return true;
            }
        }

        if (restOfUrl) {
            return false; // unmatched url remnant
        }

        return true;
    }

    protected update(): void {
        if (!this.contentAppended) {
            if (!this.args) {
                throw new Error('args not yet parsed');
            }
            const self = this;
            const argFuncs: any = {};
            for (const key in this.args) {
                argFuncs[key] = () => this.args![key];
            }
            if (this.initStoresFn && !hasStoreHydrationData()) {
                this.component.setLazyContent(async function makeRouteContentWithStores() {
                    const data = await self.initStoresFn!(self.args!);
                    setStoreHydrationData(data);
                    return self.makeContent(argFuncs);
                }, this.transient);
            } else {
                this.component.setLazyContent(function makeRouteContent() { return self.makeContent(argFuncs); }, this.transient);
            }
            this.contentAppended = true;
        }

        if (this.outlet) {
            if (this.matchedSubRoute !== this.outletSubRoute) {
                this.outlet.clear();
                if (this.matchedSubRoute) {
                    this.matchedSubRoute.update();
                    this.outlet.appendChild(this.matchedSubRoute.component);
                }
                this.outletSubRoute = this.matchedSubRoute;
            }
        }
    }

    protected setOutlet(outlet: Component): void {
        if (this.outlet !== outlet) {
            if (this.outlet) {
                throw new Error('outlet already set');
            }
            this.outlet = outlet;
            this.update();
        }
    }
}


const RouterContext = new Context<Router>('RouterContext');

export class Router extends Route<{}> {
    constructor(makeContent?: () => FragmentItem) {
        super(null, '', makeContent ?? Outlet);
        this.component.addMountListener(() => window.addEventListener('popstate', this.tryMatchLocation));
        this.component.addUnmountListener(() => window.removeEventListener('popstate', this.tryMatchLocation));
        this.component.provideContext(RouterContext, this);
    }

    mount(container: HTMLElement): Component<null> {
        this.tryMatchLocation();
        new Component(container).appendChild(this.component).mount();
        return this.component;
    }

    pushUrl(url: string): boolean {
        if (this.tryMatch(url)) {
            history.pushState(null, '', url);
            return true;
        } else {
            console.warn('pushUrl with unknown url: ' + url);
            return false;
        }
    }

    replaceUrl(url: string): boolean {
        if (this.tryMatch(url)) {
            history.replaceState(null, '', url);
            return true;
        } else {
            console.warn('replaceUrl with unknown url: ' + url);
            return false;
        }
    }

    matches(url: string): boolean {
        return this.tryMatch(url);
    }

    getChunksForUrl(url: string): string[] | null {
        if (!this.tryMatch(url)) {
            return null;
        }
        return this.getMatchedChunks();
    }

    private tryMatchLocation = () => {
        const url = document.location.pathname + document.location.search;
        if (!this.tryMatch(url)) {
            console.warn('going back to / due to unknown location: ' + url);
            this.replaceUrl('/');
        }
    };
}

function Link(url: string, ...fragment: HTMLChildFragment<HTMLAnchorElement>[]) {
    return a({
        href: url,
        onclick(ev: MouseEvent) {
            ev.preventDefault();
            this.getContext(RouterContext).pushUrl(url);
        }
    }, ...fragment);
}
