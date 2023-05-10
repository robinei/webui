import { Component, FragmentItem } from "./core";


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

function parsePathSpec(pathSpec: string): PathMatcher[] {
    if (pathSpec === '') {
        return [];
    }
    return pathSpec.split('/').map(part => {
        if (part === '') {
            return path => {
                if (path.startsWith('/')) {
                    return path.substring(1);
                }
                return path;
            };
        }

        if (part.indexOf(':') < 0) {
            const partSlash = part + '/';
            return path => {
                if (path === part) {
                    return '';
                }
                if (path.startsWith(partSlash)) {
                    return path.substring(partSlash.length);
                }
                return path;
            };
        }

        const [key, type] = part.split(':');
        if (!key || !type) {
            throw new Error('bad path spec');
        }
        let parser: (s: string) => unknown;
        switch (type) {
            case 'string': parser = s => s; break;
            case 'number': parser = s => {
                const num = Number(s);
                return isNaN(num) ? null : num;
            }; break;
            case 'boolean': parser = s => {
                switch (s.toLowerCase()) {
                    case '0':
                    case 'no':
                    case 'false': return false;
                    case '1':
                    case 'yes':
                    case 'true': return true;
                    default: return null;
                }
            }; break;
            default: throw new Error(`unknown type '${type}' in path spec`);
        }

        return (path, args) => {
            const i = path.indexOf('/');
            const prefix = path.substring(0, i < 0 ? path.length : i);
            const value = parser(prefix);
            if (value !== null) {
                args[key] = value;
                return path.substring(prefix.length);
            }
            return path;
        };
    });
}

export class RouterNode<Args> {
    private readonly subnodes: RouterNode<any>[] = [];
    private matchers: PathMatcher[];
    private args?: Args;
    private component?: Component;

    constructor(readonly pathSpec: string, private readonly makeContent: (args: FunctionsOf<Args>) => FragmentItem | Node) {
        this.matchers = parsePathSpec(pathSpec);
    }

    route<PathSpec extends string>(
        pathSpec: PathSpec,
        makeContent: (args: FunctionsOf<Args & ParsePathSpec<PathSpec>>) => FragmentItem | Node
    ): RouterNode<Args & ParsePathSpec<PathSpec>> {
        const r = new RouterNode(pathSpec, makeContent);
        this.subnodes.push(r);
        return r;
    }

    goto(path: string): boolean {
        return this.handlePath(path, {});
    }

    private handlePath(path: string, parentArgs: { [key: string]: unknown }): boolean {
        const args: { [key: string]: unknown } = { ...parentArgs };

        let rest = path;
        for (const matcher of this.matchers) {
            const prev = rest;
            rest = matcher(rest, args);
            if (Object.is(prev, rest)) {
                return false;
            }
        }

        this.args = args as any;
        const comp = this.getComponent();

        for (const subnode of this.subnodes) {
            if (subnode.handlePath(rest, args)) {
                if (comp.setContent) {
                    comp.setContent(subnode.getComponent());
                } else {
                    comp.clear();
                    comp.appendChild(subnode.getComponent());
                }
                return true;
            }
        }

        return true;
    }

    getComponent(): Component {
        if (!this.component) {
            if (!this.args) {
                throw new Error('args should have been parsed');
            }
            const argFuncs: FunctionsOf<Args> = {} as any;
            for (const key in this.args) {
                (argFuncs as any)[key] = () => this.args![key]!;
            }
            const name = this.pathSpec ? 'RouterNode:' + this.pathSpec : 'RouterRoot';
            const content = this.makeContent(argFuncs);
            if (content instanceof Node) {
                this.component = new Component(content, name);
            } else {
                this.component = new Component(null, name).appendFragment(content);
            }
        }
        return this.component;
    }
}


export function Router(element?: HTMLElement): RouterNode<{}> {
    return new RouterNode('', () => element);
}
