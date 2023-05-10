import { Component, Context, FragmentItem, flattenFragment } from "./core";
import { deepEqual } from "./util";


type ParsePathSpec<P extends string> =
    P extends `${infer Prefix extends string}/${infer Rest extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpec<Rest>
        : ParsePathSpecSuffix<P>;

type ParsePathSpecSuffix<S extends string> =
    S extends `${infer Prefix extends string}?${infer Query extends string}`
        ? ParsePathSpecTypedKey<Prefix> & ParsePathSpecQuery<Query>
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
    [K in keyof T]: () => T[K];
};


type Test = FunctionsOf<ParsePathSpec<'/hello/foo:string/test/bar:number/asdf?arg:boolean&arg2:number'>>;
const test: Test = {} as any;




type PathMatcher = (path: string, args: { [key: string]: unknown }) => string;

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
            return path;
        };
    }

    let partEnd = pathSpec.indexOf('/');
    if (partEnd < 0) {
        partEnd = pathSpec.length;
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
            return path;
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
        return path;
    };
}

function createValueParser(type: string): (s: string) => unknown {
    switch (type) {
        case 'string': return s => s;
        case 'number': return s => {
            const num = Number(s);
            return isNaN(num) ? null : num;
        };
        case 'boolean': return s => {
            switch (s.toLowerCase()) {
                case '0':
                case 'no':
                case 'false': return false;
                case '1':
                case 'yes':
                case 'true': return true;
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
    runTest('/foo:number', '/nan', 'nan', {});
    runTest('/foo:number/bar:string', '/123/str', '', {foo: 123, bar: 'str'});
    runTest('/prefix/foo:number/bar:string', '/prefix/123/str', '', {foo: 123, bar: 'str'});

    function runTest(spec: string, path: string, expectedRemainder: string, expectedArgs: { [key: string]: unknown }): void {
        const matcher = parsePathSpec(spec);
        const args: { [key: string]: unknown } = {};
        const remainder = matcher(path, args);
        console.assert(remainder === expectedRemainder);
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
    public readonly component: Component<null>;
    private fragmentCreated = false;

    private args: { [key: string]: unknown } = {};

    private matchedSubRoute?: Route<any>;
    private outletSubRoute?: Route<any>;
    private outlet?: Component;

    constructor(readonly pathSpec: string, private readonly makeFragment: (args: FunctionsOf<Args>) => FragmentItem) {
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
        return route;
    }

    protected tryMatch(path: string, parentArgs?: { [key: string]: unknown }): boolean {
        const args = { ...parentArgs };
        const restOfPath = this.matcher(path, args);
        if (restOfPath === path && this.pathSpec) {
            return false;
        }
        
        this.args = args;
        
        if (!this.fragmentCreated) {
            const argFuncs: any = {};
            for (const key in this.args) {
                argFuncs[key] = () => this.args[key];
            }
            this.component.appendChildren(flattenFragment(this.makeFragment(argFuncs)));
            this.fragmentCreated = true;
        }

        for (const route of this.subRoutes) {
            if (route.tryMatch(restOfPath, args)) {
                this.matchedSubRoute = route;
                this.maybeFillOutlet();
                break;
            }
        }

        return true;
    }

    internalSetOutlet(outlet: Component): void {
        if (this.outlet !== outlet) {
            if (this.outlet) {
                throw new Error('outlet already set');
            }
            this.outlet = outlet;
            this.maybeFillOutlet();
        }
    }

    private maybeFillOutlet(): void {
        if (this.outlet) {
            if (this.matchedSubRoute !== this.outletSubRoute) {
                this.outlet.clear();
                if (this.matchedSubRoute) {
                    this.outlet.appendChild(this.matchedSubRoute.component);
                }
                this.outletSubRoute = this.matchedSubRoute;
            }
        }
    }
}


export class Router extends Route<{}> {
    constructor() {
        super('', () => Outlet());
    }

    init(): boolean {
        this.component.addMountListener(this.onMountRouter);
        this.component.addUnmountListener(this.onUnmountRouter);
        return this.tryMatch(document.location.pathname, {});
    }

    push(path: string): boolean {
        history.pushState(null, '', path);
        return this.tryMatch(path);
    }

    replace(path: string): boolean {
        history.replaceState(null, '', path);
        return this.tryMatch(path);
    }

    private onMountRouter = () => window.addEventListener('popstate', this.onPopState);
    private onUnmountRouter = () => window.removeEventListener('popstate', this.onPopState);
    private onPopState = (_: PopStateEvent) => this.tryMatch(document.location.pathname);
}
