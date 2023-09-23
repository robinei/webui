import { Component, Context, FragmentItem, Html } from "./core";
import { arraysEqual, deepEqual } from "./util";


type ParsePathSpec<P extends string> =
    P extends `${infer Prefix extends string}/${infer Rest extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpec<Rest>
        : ParsePathSpecSuffix<P>;

type ParsePathSpecSuffix<S extends string> =
    S extends `${infer Prefix extends string}?${infer Query extends string}`
        ? ParsePathSpecTypedKey<Prefix> & Partial<ParsePathSpecQuery<Query>>
        : ParsePathSpecTypedKey<S>;

type ParsePathSpecQuery<Q extends string> =
    Q extends `${infer Prefix extends string}&${infer Rest extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpecQuery<Rest>
        : ParsePathSpecTypedKey<Q>;

type ParsePathSpecTypedKey<S extends string> =
    S extends `${infer Key extends string}:${infer Type extends string}`
        ? { [_ in Key]: ParsePathSpecType<Type> }
        : {};

type ParsePathSpecType<S extends string> =
    S extends 'string' ? string :
    S extends 'number' ? number :
    S extends 'boolean' ? boolean : unknown;

type JoinPath<A extends string, B extends string> =
    A extends `${infer AP extends string}/`
        ? (B extends `/${infer BS extends string}` ? `${AP}/${BS}` : `${AP}/${B}`)
        : (B extends `/${infer BS extends string}` ? `${A}/${BS}` : `${A}/${B}`);

type FunctionsOf<T> = {
    [K in keyof T]-?: () => T[K];
};


type Test = FunctionsOf<ParsePathSpec<'/hello/foo:string/test/bar:number/asdf?arg:boolean&arg2:number'>>;
const test: Test = {} as any;




type PathMatcher = (path: string, args: { [key: string]: unknown }) => string | false;

function parsePathSpec(pathSpec: string): PathMatcher {
    if (!pathSpec) {
        return (path, _) => path;
    }

    if (pathSpec.startsWith('/')) {
        const parseRest = parsePathSpec(pathSpec.substring(1));
        return (path, args) => {
            if (path.startsWith('/')) {
                return parseRest(path.substring(1), args);
            }
            return false;
        };
    }

    if (pathSpec.startsWith('?')) {
        const queryParsers: { [key: string]: (s: string) => unknown } = {};
        for (const specPart of pathSpec.substring(1).split('&')) {
            const [key, type] = specPart.split(':');
            if (!key || !type) {
                throw new Error('bad query spec');
            }
            queryParsers[key] = createValueParser(type, true);
        }
        return (path, args) => {
            if (path.startsWith('?')) {
                const query: { [key: string]: string } = {};
                for (const queryPart of path.substring(1).split('&')) {
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
                        if (parsedValue != null) {
                            args[key] = parsedValue;
                        }
                    }
                }
            } else if (path) {
                return false;
            }
            return '';
        };
    }

    let partEnd = pathSpec.indexOf('/');
    if (partEnd < 0) {
        partEnd = pathSpec.indexOf('?');
        if (partEnd < 0) {
            partEnd = pathSpec.length;
        }
    }
    const fragment = pathSpec.substring(0, partEnd);
    const parseRest = parsePathSpec(pathSpec.substring(partEnd));
    const splitFrag = fragment.split(':');

    if (splitFrag.length === 1) {
        // no ':' in fragment; match verbatim
        return (path, args) => {
            if (path.startsWith(fragment)) {
                return parseRest(path.substring(fragment.length), args);
            }
            return false;
        };
    }

    if (splitFrag.length !== 2) {
        throw new Error(`bad path spec fragment: ${fragment}`);
    }

    // fragment has form '<key>:<type>', like 'category:string', and must be parsed as a value of the specified type
    const [key, type] = splitFrag;
    if (!key || !type) {
        throw new Error(`bad path spec fragment: ${fragment}`);
    }

    const parser = createValueParser(type);

    return (path, args) => {
        const i = path.indexOf('/');
        const prefix = path.substring(0, i < 0 ? path.length : i);
        const value = parser(prefix);
        if (value !== null) {
            args[key] = value;
            return parseRest(path.substring(prefix.length), args);
        }
        return false;
    };
}

function createValueParser(type: string, allowEmpty: boolean = false): (s: string) => unknown {
    switch (type) {
        case 'string': return function valueParser(s) {
            return !allowEmpty && !s ? null : s;
        };
        case 'number': return function valueParser(s) {
            if (!allowEmpty && !s) {
                return null;
            }
            const num = Number(s);
            return isNaN(num) ? null : num;
        };
        case 'boolean': return function valueParser(s) {
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
        default: throw new Error(`unknown type '${type}' in path spec`);
    }
}



function runParsePathSpecTests() {
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

    function runTest(spec: string, path: string, expectedResult: string | false, expectedArgs: { [key: string]: unknown }): void {
        const matcher = parsePathSpec(spec);
        const args: { [key: string]: unknown } = {};
        const result = matcher(path, args);
        console.assert(result === expectedResult);
        console.assert(deepEqual(args, expectedArgs));
    }
}
runParsePathSpecTests();



const RouteContext = new Context<Route<any>>('RouteContext');

export function Outlet() {
    const component = new Component(null, 'Outlet');

    component.addMountedListener(function onMountedOutlet() {
        const route = component.getContext(RouteContext);
        route.internalSetOutlet(component);
    });
    
    return component;
}


export class Route<Args> {
    private readonly subRoutes: Route<any>[] = [];
    private readonly matcher: PathMatcher;
    private fragmentCreated = false;

    private args?: { [key: string]: unknown };

    private matchedSubRoute?: Route<any>;
    private outletSubRoute?: Route<any>; // the sub-route whose component we have currently mounted in our fragment's Outlet
    private outlet?: Component;

    readonly component: Component<null>;

    protected constructor(readonly pathSpec: string, private readonly makeFragment: (args: any) => FragmentItem) {
        this.matcher = parsePathSpec(pathSpec);
        const name = pathSpec ? `Route[${pathSpec}]` : 'Router';
        this.component = new Component(null, name).provideContext(RouteContext, this);
    }

    route<PathSpec extends string>(
        pathSpec: PathSpec,
        makeContent: (args: FunctionsOf<Args & ParsePathSpec<PathSpec>>) => FragmentItem
    ): Route<Args & ParsePathSpec<PathSpec>> {
        const route = new Route(pathSpec, makeContent);
        this.subRoutes.push(route);
        return route as any;
    }

    tryMatch(path: string, parentArgs?: { [key: string]: unknown }): boolean {
        const args = { ...parentArgs };
        const restOfPath = this.matcher(path, args);
        if (restOfPath === false) {
            return false;
        }
        
        this.args = args;

        for (const route of this.subRoutes) {
            if (route.tryMatch(restOfPath, args)) {
                this.matchedSubRoute = route;
                this.update();
                return true;
            }
        }

        if (restOfPath) {
            return false; // unmatched path remnant
        }

        return true;
    }

    internalSetOutlet(outlet: Component): void {
        if (this.outlet !== outlet) {
            if (this.outlet) {
                throw new Error('outlet already set');
            }
            this.outlet = outlet;
            this.update();
        }
    }

    private update(): void {
        if (!this.fragmentCreated) {
            if (!this.args) {
                throw new Error('args not yet parsed');
            }
            const argFuncs: any = {};
            for (const key in this.args) {
                argFuncs[key] = () => this.args![key];
            }
            this.component.appendFragment(this.makeFragment(argFuncs));
            this.fragmentCreated = true;
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
}


export class Router extends Route<{}> {
    constructor(makeFragment?: () => FragmentItem) {
        super('', makeFragment ?? (() => Outlet()));
    }

    init(): void {
        this.component.addMountListener(this.onMountRouter);
        this.component.addUnmountListener(this.onUnmountRouter);
        this.tryMatch(document.location.pathname, {});
    }

    private onMountRouter = () => {
        window.addEventListener('popstate', this.onPopState);
        mountedRouters.push(this);
    };

    private onUnmountRouter = () => {
        const index = mountedRouters.indexOf(this);
        if (index >= 0) {
            mountedRouters.splice(index, 1);
        }
        window.removeEventListener('popstate', this.onPopState);
    };

    private onPopState = (_: PopStateEvent) => {
        this.tryMatch(document.location.pathname);
    };
}


const mountedRouters: Router[] = [];

export function pushPath(path: string): void {
    history.pushState(null, '', path);
    for (const r of mountedRouters) {
        r.tryMatch(path);
    }
}

export function replacePath(path: string): void {
    history.replaceState(null, '', path);
    for (const r of mountedRouters) {
        r.tryMatch(path);
    }
}

const { a } = Html;

export function Link(path: string, fragment: FragmentItem) {
    return a(fragment).setAttributes({
        href: path,
        onclick(ev: MouseEvent) {
            ev.preventDefault();
            pushPath(path);
        }
    });
}
