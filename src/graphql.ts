// TODO:
// - @defer streaming transport: query building supported via defer(), but execute()/query.ts
//   need incremental delivery support (chunked responses, partial cache hydration)
// - Input type combinators: Zod-like schema for GraphQL input types (validates outgoing data,
//   carries structural info for schema validation tests via introspection)
// - t.id() coercion: some APIs return numeric IDs; consider t.id() accepting both string and
//   number and coercing to string, or a t.numericId() variant

// ============================================================
// gql-compose: Client-side composable GraphQL query builder
//
// Zod-like pattern: each node is a "selection" that carries:
//   - phantom TS type (for inference via Infer<>)
//   - phantom variable type (auto-collected from field args)
//   - .fragment  — the selection set string
//   - .parse()   — runtime validator (unknown → T, throws on bad shape)
//
// Non-null by default (matching typical GraphQL schemas).
// Wrap with nullable() for fields that can be null.
// Variables are auto-collected from args — no manual vars array.
// ============================================================

// --- Core types ---

type FragmentMarker = {
    readonly directive: string;
    readonly optional: boolean;
    readonly extraVars: GQLVariable[];
};

type FieldMeta = {
    readonly args?: Record<string, ArgValue>;
    readonly fieldName?: string;
    readonly directive?: string;
    readonly fragment?: FragmentMarker;
};

type GQLNode<T, V extends GQLVariable<any, any> = never> = {
    readonly _type: T;
    readonly _vars: V;
    readonly fragment: string;
    readonly vars: GQLVariable[];
    readonly meta?: FieldMeta;
    readonly parse: (data: unknown) => T;
};

type Infer<N extends GQLNode<any, any>> = N['_type'];

// --- Variables ---

type GQLVariable<N extends string = string, T = any> = {
    readonly _varType: T;
    readonly varName: N;
    readonly graphqlType: string;
};

function variable<N extends string, T>(name: N, graphqlType: string): GQLVariable<N, T> {
    return { _varType: null as any, varName: name, graphqlType };
}

const v = {
    string: <N extends string>(name: N) => variable<N, string>(name, 'String!'),
    int: <N extends string>(name: N) => variable<N, number>(name, 'Int!'),
    float: <N extends string>(name: N) => variable<N, number>(name, 'Float!'),
    boolean: <N extends string>(name: N) => variable<N, boolean>(name, 'Boolean!'),
    id: <N extends string>(name: N) => variable<N, string>(name, 'ID!'),
    nullString: <N extends string>(name: N) => variable<N, string | null>(name, 'String'),
    nullInt: <N extends string>(name: N) => variable<N, number | null>(name, 'Int'),
    nullFloat: <N extends string>(name: N) => variable<N, number | null>(name, 'Float'),
    nullBoolean: <N extends string>(name: N) => variable<N, boolean | null>(name, 'Boolean'),
    nullId: <N extends string>(name: N) => variable<N, string | null>(name, 'ID'),
    custom: <N extends string, T>(name: N, graphqlType: string) => variable<N, T>(name, graphqlType),
} as const;

// --- Errors ---

class ParseError extends Error {
    constructor(message: string) { super(message); this.name = 'ParseError'; }
}

class GraphQLError extends Error {
    constructor(public errors: { message: string;[k: string]: any }[]) {
        super(errors.map(e => e.message).join('; '));
        this.name = 'GraphQLError';
    }
}

// --- Scalar parsers (non-null: throw on null/undefined) ---

function parseString(data: unknown): string {
    if (data == null) throw new ParseError('Expected string, got null');
    if (typeof data !== 'string') throw new ParseError(`Expected string, got ${typeof data}`);
    return data;
}

function parseInt_(data: unknown): number {
    if (data == null) throw new ParseError('Expected integer, got null');
    if (typeof data !== 'number' || !Number.isInteger(data))
        throw new ParseError(`Expected integer, got ${data}`);
    return data;
}

function parseFloat_(data: unknown): number {
    if (data == null) throw new ParseError('Expected number, got null');
    if (typeof data !== 'number') throw new ParseError(`Expected number, got ${typeof data}`);
    return data;
}

function parseBoolean(data: unknown): boolean {
    if (data == null) throw new ParseError('Expected boolean, got null');
    if (typeof data !== 'boolean') throw new ParseError(`Expected boolean, got ${typeof data}`);
    return data;
}

// --- Scalar type constructors (non-null by default) ---

function makeScalar<T>(parse: (data: unknown) => T): GQLNode<T> {
    return { _type: null as any, _vars: null as never, fragment: '', vars: [], parse };
}

const t = {
    string: () => makeScalar(parseString),
    int: () => makeScalar(parseInt_),
    float: () => makeScalar(parseFloat_),
    boolean: () => makeScalar(parseBoolean),
    id: () => makeScalar(parseString),
    enum: <const V extends string>(...values: V[]) => makeScalar<V>((data: unknown) => {
        if (data == null) throw new ParseError('Expected enum, got null');
        if (typeof data !== 'string') throw new ParseError(`Expected enum string, got ${typeof data}`);
        if (!values.includes(data as V)) throw new ParseError(`Expected one of ${values.join(', ')}, got "${data}"`);
        return data as V;
    }),
    custom: <T>(parse: (data: unknown) => T) => makeScalar(parse),
} as const;

// --- Modifiers ---

function wrap<T>(node: GQLNode<any, any>, overrides: {
    fragment?: string; vars?: GQLVariable[]; meta?: FieldMeta;
    parse: (data: unknown) => T;
}): GQLNode<T, any> {
    return {
        _type: null as any, _vars: null as any,
        fragment: overrides.fragment ?? node.fragment,
        vars: overrides.vars ?? node.vars,
        meta: overrides.meta ?? node.meta,
        parse: overrides.parse,
    };
}

function nullable<T, V extends GQLVariable<any, any>>(node: GQLNode<T, V>): GQLNode<T | null, V> {
    return wrap<T | null>(node, {
        parse(data) {
            if (data == null) return null;
            return node.parse(data);
        },
    });
}

function lazy<T, V extends GQLVariable<any, any>>(thunk: () => GQLNode<T, V>): GQLNode<T, V> {
    let resolved: GQLNode<T, V> | null = null;
    const resolve = () => resolved ??= thunk();
    return {
        _type: null as any, _vars: null as any,
        get fragment() { return resolve().fragment; },
        get vars() { return resolve().vars; },
        get meta() { return resolve().meta; },
        parse(data) { return resolve().parse(data); },
    };
}

function list<T, V extends GQLVariable<any, any>>(node: GQLNode<T, V>): GQLNode<T[], V> {
    return wrap<T[]>(node, {
        parse(data) {
            if (data == null) throw new ParseError('Expected array, got null');
            if (!Array.isArray(data)) throw new ParseError('Expected array');
            return data.map((item, i) => {
                try { return node.parse(item); }
                catch (e) { throw new ParseError(`[${i}]: ${(e as ParseError).message}`); }
            });
        },
    });
}

// --- Args & field() ---

type RawArgValue = { readonly __raw: string };
function raw(value: string): RawArgValue { return { __raw: value }; }

type ArgValue = GQLVariable<any, any> | RawArgValue;

function isVariable(val: ArgValue): val is GQLVariable { return 'varName' in val; }

type ExtractArgVars<A> = A extends Record<string, infer V>
    ? V extends GQLVariable<infer N, infer T> ? GQLVariable<N, T> : never
    : never;

function field<T, NV extends GQLVariable<any, any>, A extends Record<string, ArgValue>>(
    args: A,
    type: GQLNode<T, NV>,
): GQLNode<T, NV | ExtractArgVars<A>> {
    const argVars = Object.values(args).filter(isVariable);
    return {
        _type: null as any, _vars: null as any,
        fragment: type.fragment,
        vars: [...type.vars, ...argVars],
        meta: { ...type.meta, args },
        parse: type.parse,
    };
}

function alias<T, V extends GQLVariable<any, any>>(fieldName: string, node: GQLNode<T, V>): GQLNode<T, V> {
    return {
        _type: null as any, _vars: null as any,
        fragment: node.fragment, vars: node.vars,
        meta: { ...node.meta, fieldName },
        parse: node.parse,
    };
}

// --- Directives ---

function directive<T, V extends GQLVariable<any, any>>(dir: string, node: GQLNode<T, V>): GQLNode<T, V> {
    return {
        _type: null as any, _vars: null as any,
        fragment: node.fragment, vars: node.vars,
        meta: { ...node.meta, directive: node.meta?.directive ? `${dir} ${node.meta.directive}` : dir },
        parse: node.parse,
    };
}

function skip<T, V extends GQLVariable<any, any>, N extends string>(
    variable: GQLVariable<N, boolean>,
    node: GQLNode<T, V>,
): GQLNode<T | undefined, V | GQLVariable<N, boolean>> {
    return {
        _type: null as any, _vars: null as any,
        fragment: node.fragment, vars: [...node.vars, variable],
        meta: { ...node.meta, directive: `@skip(if: $${variable.varName})${node.meta?.directive ? ' ' + node.meta.directive : ''}` },
        parse(data) {
            if (data === undefined) return undefined;
            return node.parse(data);
        },
    };
}

function include<T, V extends GQLVariable<any, any>, N extends string>(
    variable: GQLVariable<N, boolean>,
    node: GQLNode<T, V>,
): GQLNode<T | undefined, V | GQLVariable<N, boolean>> {
    return {
        _type: null as any, _vars: null as any,
        fragment: node.fragment, vars: [...node.vars, variable],
        meta: { ...node.meta, directive: `@include(if: $${variable.varName})${node.meta?.directive ? ' ' + node.meta.directive : ''}` },
        parse(data) {
            if (data === undefined) return undefined;
            return node.parse(data);
        },
    };
}

// --- Object selection ---

type SelectionFields = Record<string, GQLNode<any, any>>;

type InferSelection<F extends SelectionFields> = {
    [K in keyof F]: F[K] extends GQLNode<infer T, any> ? T : never;
};

type SelectionVars<F extends SelectionFields> = {
    [K in keyof F]: F[K] extends GQLNode<any, infer V> ? V : never;
}[keyof F];

function emitField(key: string, node: GQLNode<any, any>): string {
    const meta = node.meta;
    let argsStr = '';
    if (meta?.args) {
        const entries = Object.entries(meta.args);
        if (entries.length > 0) {
            argsStr = '(' + entries.map(([name, val]: [string, ArgValue]) =>
                '__raw' in val ? `${name}: ${val.__raw}` : `${name}: $${val.varName}`
            ).join(', ') + ')';
        }
    }
    const gqlName = meta?.fieldName ?? key;
    const prefix = gqlName !== key ? `${key}: ${gqlName}` : key;
    const dir = meta?.directive ? ` ${meta.directive}` : '';
    return node.fragment ? `${prefix}${argsStr}${dir} ${node.fragment}` : `${prefix}${argsStr}${dir}`;
}

function select<F extends SelectionFields>(fields: F): GQLNode<InferSelection<F>, SelectionVars<F>> {
    const parts: string[] = [];
    const allVars: GQLVariable[] = [];
    const fragmentGroups = new Map<FragmentMarker, [string, GQLNode<any, any>][]>();

    for (const [key, node] of Object.entries(fields)) {
        const marker = node.meta?.fragment;
        if (marker) {
            let group = fragmentGroups.get(marker);
            if (!group) { group = []; fragmentGroups.set(marker, group); }
            group.push([key, node]);
        } else {
            parts.push(emitField(key, node));
        }
        allVars.push(...node.vars);
    }

    // Emit inline fragment groups
    for (const [marker, group] of fragmentGroups) {
        const innerParts = group.map(([key, node]) => emitField(key, node));
        parts.push(`... ${marker.directive} { ${innerParts.join(' ')} }`);
        allVars.push(...marker.extraVars);
    }

    return {
        _type: null as any, _vars: null as any,
        fragment: `{ ${parts.join(' ')} }`,
        vars: allVars,
        parse(data) {
            if (data == null) throw new ParseError('Expected object, got null');
            if (typeof data !== 'object') throw new ParseError('Expected object');
            const result: Record<string, any> = {};
            for (const [key, node] of Object.entries(fields)) {
                const optional = node.meta?.fragment?.optional;
                if (optional && (data as any)[key] === undefined) {
                    result[key] = undefined;
                } else {
                    try { result[key] = node.parse((data as any)[key]); }
                    catch (e) { throw new ParseError(`${key}: ${(e as ParseError).message}`); }
                }
            }
            return result as any;
        },
    };
}

// --- Inline fragments ---

type DeferFields<F extends SelectionFields> = {
    [K in keyof F]: F[K] extends GQLNode<infer T, infer V> ? GQLNode<T | undefined, V> : F[K];
};

type DeferOpts = { label?: string; if?: GQLVariable<string, boolean> };

function fragment<F extends SelectionFields>(dir: string, fields: F): F {
    const marker: FragmentMarker = { directive: dir, optional: false, extraVars: [] };
    const result: any = {};
    for (const [key, node] of Object.entries(fields)) {
        result[key] = { ...node, meta: { ...node.meta, fragment: marker } };
    }
    return result;
}

function defer<F extends SelectionFields>(fields: F): DeferFields<F>;
function defer<F extends SelectionFields>(opts: DeferOpts, fields: F): DeferFields<F>;
function defer(fieldsOrOpts: any, maybeFields?: any): any {
    const hasOpts = maybeFields !== undefined;
    const opts: DeferOpts = hasOpts ? fieldsOrOpts : {};
    const fields: SelectionFields = hasOpts ? maybeFields : fieldsOrOpts;
    const args: string[] = [];
    if (opts.label) args.push(`label: "${opts.label}"`);
    if (opts.if) args.push(`if: $${opts.if.varName}`);
    const dir = args.length ? `@defer(${args.join(', ')})` : '@defer';
    const extraVars = opts.if ? [opts.if] : [];
    const marker: FragmentMarker = { directive: dir, optional: true, extraVars };
    const result: any = {};
    for (const [key, node] of Object.entries(fields)) {
        result[key] = { ...node, meta: { ...node.meta, fragment: marker } };
    }
    return result;
}

// --- Union / interface types ---

type UnionBranches = Record<string, GQLNode<any, any>>;

type InferUnion<B extends UnionBranches> = {
    [K in keyof B]: B[K] extends GQLNode<infer T, any>
    ? T & { __typename: K }
    : never
}[keyof B];

type UnionVars<B extends UnionBranches> = {
    [K in keyof B]: B[K] extends GQLNode<any, infer V> ? V : never
}[keyof B];

function union<B extends UnionBranches>(branches: B): GQLNode<InferUnion<B>, UnionVars<B>> {
    const parts: string[] = ['__typename'];
    const allVars: GQLVariable[] = [];

    for (const [typeName, node] of Object.entries(branches)) {
        parts.push(`... on ${typeName} ${node.fragment}`);
        allVars.push(...node.vars);
    }

    return {
        _type: null as any, _vars: null as any,
        fragment: `{ ${parts.join(' ')} }`,
        vars: allVars,
        parse(data) {
            if (data == null) throw new ParseError('Expected union object, got null');
            if (typeof data !== 'object') throw new ParseError('Expected union object');
            const typename = (data as any).__typename;
            if (typeof typename !== 'string') throw new ParseError('Missing __typename on union type');
            const branch = branches[typename];
            if (!branch) throw new ParseError(`Unknown __typename "${typename}", expected one of: ${Object.keys(branches).join(', ')}`);
            const result = branch.parse(data);
            return { ...result, __typename: typename } as any;
        },
    };
}

// --- Operation builder ---

type VarsToObject<V extends GQLVariable<any, any>> =
    [V] extends [never] ? {} : { [K in V as K['varName']]: K['_varType'] };

type GQLOperation<TData, TVars extends Record<string, any> = {}> = {
    readonly _type: TData;
    readonly _vars: TVars;
    readonly query: string;
    readonly parse: (data: unknown) => TData;
};

type OperationResult<Q> = Q extends GQLOperation<infer T, any> ? T : never;
type OperationVariables<Q> = Q extends GQLOperation<any, infer V> ? V : never;

function operation<F extends SelectionFields>(
    kind: 'query' | 'mutation' | 'subscription',
    name: string,
    fields: F,
): GQLOperation<InferSelection<F>, VarsToObject<SelectionVars<F>>> {
    const root = select(fields);

    // Deduplicate variables by name
    const varsMap = new Map<string, GQLVariable>();
    for (const vr of root.vars) varsMap.set(vr.varName, vr);
    const vars = [...varsMap.values()];

    const varDecl = vars.length > 0
        ? `(${vars.map(vr => `$${vr.varName}: ${vr.graphqlType}`).join(', ')})`
        : '';

    return {
        _type: null as any, _vars: null as any,
        query: `${kind} ${name}${varDecl} ${root.fragment}`,
        parse: root.parse,
    };
}

function query<F extends SelectionFields>(name: string, fields: F) {
    return operation('query', name, fields);
}

function mutation<F extends SelectionFields>(name: string, fields: F) {
    return operation('mutation', name, fields);
}

// TODO: subscribe() — WebSocket transport returning async iterator / Observable
function subscription<F extends SelectionFields>(name: string, fields: F) {
    return operation('subscription', name, fields);
}

// --- Execute ---

async function execute<T, TVars extends Record<string, any>>(
    endpoint: string,
    op: GQLOperation<T, TVars>,
    ...args: {} extends TVars ? [variables?: TVars] : [variables: TVars]
): Promise<T> {
    const variables = args[0];
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: op.query, variables }),
    });
    const json = await res.json();
    if (json.errors?.length) throw new GraphQLError(json.errors);
    if (typeof json !== 'object' || json === null || !('data' in json))
        throw new ParseError('Expected { data: ... } envelope');
    return op.parse(json.data);
}

export { t, v, raw, field, alias, directive, skip, include, select, fragment, defer, union, nullable, lazy, list, query, mutation, subscription, execute };
export { ParseError, GraphQLError };
export type { GQLNode, GQLVariable, GQLOperation, Infer, OperationResult, OperationVariables };
