import { type TestSuite, assert, assertEqual, assertThrows } from './runner';
import {
    t, v, raw, field, alias, directive, skip, include,
    select, union, nullable, lazy, list,
    query, mutation, subscription,
    ParseError, GraphQLError,
} from '../../graphql';

export const graphqlSuite: TestSuite = {
    name: 'GraphQL',
    tests: [

        // ============================================================
        // Scalar types — fragment & parse
        // ============================================================

        {
            name: 't.string() parses strings',
            run() {
                const node = t.string();
                assertEqual(node.parse('hello'), 'hello');
                assertEqual(node.fragment, '');
            },
        },
        {
            name: 't.string() rejects null',
            run() {
                assertThrows(() => t.string().parse(null));
                assertThrows(() => t.string().parse(undefined));
            },
        },
        {
            name: 't.string() rejects non-string',
            run() {
                assertThrows(() => t.string().parse(42));
                assertThrows(() => t.string().parse(true));
            },
        },
        {
            name: 't.int() parses integers',
            run() {
                assertEqual(t.int().parse(42), 42);
                assertEqual(t.int().parse(0), 0);
                assertEqual(t.int().parse(-1), -1);
            },
        },
        {
            name: 't.int() rejects floats and non-numbers',
            run() {
                assertThrows(() => t.int().parse(3.14));
                assertThrows(() => t.int().parse('42'));
                assertThrows(() => t.int().parse(null));
            },
        },
        {
            name: 't.float() parses numbers',
            run() {
                assertEqual(t.float().parse(3.14), 3.14);
                assertEqual(t.float().parse(42), 42);
                assertEqual(t.float().parse(0), 0);
            },
        },
        {
            name: 't.float() rejects non-numbers',
            run() {
                assertThrows(() => t.float().parse('3.14'));
                assertThrows(() => t.float().parse(null));
            },
        },
        {
            name: 't.boolean() parses booleans',
            run() {
                assertEqual(t.boolean().parse(true), true);
                assertEqual(t.boolean().parse(false), false);
            },
        },
        {
            name: 't.boolean() rejects non-booleans',
            run() {
                assertThrows(() => t.boolean().parse(0));
                assertThrows(() => t.boolean().parse('true'));
                assertThrows(() => t.boolean().parse(null));
            },
        },
        {
            name: 't.id() parses strings (same as string)',
            run() {
                assertEqual(t.id().parse('abc-123'), 'abc-123');
                assertThrows(() => t.id().parse(123));
            },
        },
        {
            name: 't.enum() parses valid values',
            run() {
                const status = t.enum('Alive', 'Dead', 'unknown');
                assertEqual(status.parse('Alive'), 'Alive');
                assertEqual(status.parse('Dead'), 'Dead');
                assertEqual(status.parse('unknown'), 'unknown');
            },
        },
        {
            name: 't.enum() rejects invalid values',
            run() {
                const status = t.enum('Alive', 'Dead');
                assertThrows(() => status.parse('Other'));
                assertThrows(() => status.parse(null));
                assertThrows(() => status.parse(42));
            },
        },
        {
            name: 't.enum() error message lists valid values',
            run() {
                const status = t.enum('A', 'B', 'C');
                try {
                    status.parse('X');
                    assert(false, 'should throw');
                } catch (e: unknown) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        assert(e.message.includes('A'));
                        assert(e.message.includes('B'));
                        assert(e.message.includes('C'));
                        assert(e.message.includes('"X"'));
                    }
                }
            },
        },
        {
            name: 't.custom() uses custom parser',
            run() {
                const date = t.custom((data: unknown) => {
                    if (typeof data !== 'string') throw new ParseError('Expected date string');
                    return new Date(data);
                });
                const result = date.parse('2024-01-01');
                assert(result instanceof Date);
                assertEqual(result.getFullYear(), 2024);
            },
        },

        // ============================================================
        // nullable()
        // ============================================================

        {
            name: 'nullable() allows null',
            run() {
                const node = nullable(t.string());
                assertEqual(node.parse(null), null);
                assertEqual(node.parse(undefined), null);
            },
        },
        {
            name: 'nullable() passes through non-null values',
            run() {
                assertEqual(nullable(t.string()).parse('hello'), 'hello');
                assertEqual(nullable(t.int()).parse(42), 42);
            },
        },
        {
            name: 'nullable() still validates type on non-null',
            run() {
                assertThrows(() => nullable(t.string()).parse(42));
            },
        },

        // ============================================================
        // list()
        // ============================================================

        {
            name: 'list() parses arrays',
            run() {
                const node = list(t.string());
                const result = node.parse(['a', 'b', 'c']);
                assertEqual(result.length, 3);
                assertEqual(result[0]!, 'a');
                assertEqual(result[2]!, 'c');
            },
        },
        {
            name: 'list() parses empty arrays',
            run() {
                assertEqual(list(t.int()).parse([]).length, 0);
            },
        },
        {
            name: 'list() rejects null and non-arrays',
            run() {
                assertThrows(() => list(t.string()).parse(null));
                assertThrows(() => list(t.string()).parse('not array'));
                assertThrows(() => list(t.string()).parse({}));
            },
        },
        {
            name: 'list() validates each item',
            run() {
                assertThrows(() => list(t.int()).parse([1, 'two', 3]));
            },
        },
        {
            name: 'list() error includes index',
            run() {
                try {
                    list(t.int()).parse([1, 2, 'bad']);
                    assert(false, 'should throw');
                } catch (e) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        assert(e.message.includes('[2]'));
                    }
                }
            },
        },
        {
            name: 'nullable(list()) allows null array',
            run() {
                const node = nullable(list(t.string()));
                assertEqual(node.parse(null), null);
                const result = node.parse(['a']);
                assert(result !== null);
                assertEqual(result![0]!, 'a');
            },
        },
        {
            name: 'list(nullable()) allows null items',
            run() {
                const node = list(nullable(t.string()));
                const result = node.parse(['a', null, 'b']);
                assertEqual(result[0]!, 'a');
                assertEqual(result[1]!, null);
                assertEqual(result[2]!, 'b');
            },
        },

        // ============================================================
        // select() — object selection
        // ============================================================

        {
            name: 'select() parses object fields',
            run() {
                const node = select({
                    id: t.id(),
                    name: t.string(),
                    age: t.int(),
                });
                const result = node.parse({ id: '1', name: 'Alice', age: 30 });
                assertEqual(result.id, '1');
                assertEqual(result.name, 'Alice');
                assertEqual(result.age, 30);
            },
        },
        {
            name: 'select() generates fragment',
            run() {
                const node = select({
                    id: t.id(),
                    name: t.string(),
                });
                assertEqual(node.fragment, '{ id name }');
            },
        },
        {
            name: 'select() rejects null',
            run() {
                const node = select({ id: t.id() });
                assertThrows(() => node.parse(null));
                assertThrows(() => node.parse(undefined));
            },
        },
        {
            name: 'select() error includes field name',
            run() {
                const node = select({ name: t.string(), age: t.int() });
                try {
                    node.parse({ name: 'Alice', age: 'thirty' });
                    assert(false, 'should throw');
                } catch (e) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        assert(e.message.includes('age:'));
                    }
                }
            },
        },
        {
            name: 'select() ignores extra fields in data',
            run() {
                const node = select({ id: t.id() });
                const result = node.parse({ id: '1', extra: 'stuff' });
                assertEqual(result.id, '1');
            },
        },
        {
            name: 'nested select() generates nested fragment',
            run() {
                const node = select({
                    user: select({
                        id: t.id(),
                        name: t.string(),
                    }),
                });
                assertEqual(node.fragment, '{ user { id name } }');
            },
        },
        {
            name: 'nested select() parses nested objects',
            run() {
                const node = select({
                    user: select({ name: t.string() }),
                });
                const result = node.parse({ user: { name: 'Alice' } });
                assertEqual(result.user.name, 'Alice');
            },
        },
        {
            name: 'nested select() error path is chained',
            run() {
                const node = select({
                    user: select({ name: t.string() }),
                });
                try {
                    node.parse({ user: { name: 42 } });
                    assert(false);
                } catch (e) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        assert(e.message.includes('user:'));
                        assert(e.message.includes('name:'));
                    }
                }
            },
        },

        // ============================================================
        // Reusable selections (fragment-like reuse)
        // ============================================================

        {
            name: 'selections can be reused across queries',
            run() {
                const userFields = select({
                    id: t.id(),
                    name: t.string(),
                });
                const q1 = query('Q1', { users: list(userFields) });
                const q2 = query('Q2', { me: userFields });
                assert(q1.query.includes('users { id name }'));
                assert(q2.query.includes('me { id name }'));
            },
        },
        {
            name: 'spread reuse for field subsets',
            run() {
                const base = { id: t.id(), name: t.string() };
                const full = select({ ...base, email: nullable(t.string()) });
                assertEqual(full.fragment, '{ id name email }');
                const result = full.parse({ id: '1', name: 'A', email: null });
                assertEqual(result.email, null);
            },
        },

        // ============================================================
        // field() — arguments
        // ============================================================

        {
            name: 'field() attaches args to fragment',
            run() {
                const node = select({
                    user: field({ id: v.id('userId') }, select({
                        name: t.string(),
                    })),
                });
                assertEqual(node.fragment, '{ user(id: $userId) { name } }');
            },
        },
        {
            name: 'field() collects variables',
            run() {
                const node = field({ id: v.id('userId') }, t.string());
                assertEqual(node.vars.length, 1);
                assertEqual(node.vars[0]!.varName, 'userId');
                assertEqual(node.vars[0]!.graphqlType, 'ID!');
            },
        },
        {
            name: 'field() with raw args',
            run() {
                const node = select({
                    user: field({ id: raw('"1"') }, select({ name: t.string() })),
                });
                assertEqual(node.fragment, '{ user(id: "1") { name } }');
                // raw args don't add variables
                assertEqual(node.vars.length, 0);
            },
        },
        {
            name: 'field() with multiple args',
            run() {
                const node = select({
                    users: field(
                        { limit: v.int('limit'), offset: v.int('offset') },
                        list(select({ id: t.id() })),
                    ),
                });
                assert(node.fragment.includes('limit: $limit'));
                assert(node.fragment.includes('offset: $offset'));
                assertEqual(node.vars.length, 2);
            },
        },
        {
            name: 'field() parse delegates to inner type',
            run() {
                const node = field({ id: v.id('id') }, select({ name: t.string() }));
                const result = node.parse({ name: 'Alice' });
                assertEqual(result.name, 'Alice');
            },
        },

        // ============================================================
        // alias()
        // ============================================================

        {
            name: 'alias() renames field in fragment',
            run() {
                const userSel = select({ id: t.id(), name: t.string() });
                const node = select({
                    first: alias('user', field({ id: raw('"1"') }, userSel)),
                    second: alias('user', field({ id: raw('"2"') }, userSel)),
                });
                assert(node.fragment.includes('first: user(id: "1")'));
                assert(node.fragment.includes('second: user(id: "2")'));
            },
        },
        {
            name: 'alias() parses using JS key name',
            run() {
                const node = select({
                    myUser: alias('user', select({ name: t.string() })),
                });
                const result = node.parse({ myUser: { name: 'Alice' } });
                assertEqual(result.myUser.name, 'Alice');
            },
        },

        // ============================================================
        // Directives — directive(), skip(), include()
        // ============================================================

        {
            name: 'directive() adds directive string',
            run() {
                const node = select({
                    name: directive('@deprecated', t.string()),
                });
                assert(node.fragment.includes('name @deprecated'));
            },
        },
        {
            name: 'skip() generates @skip directive',
            run() {
                const $hide = v.boolean('hide');
                const node = select({
                    email: skip($hide, t.string()),
                });
                assert(node.fragment.includes('email @skip(if: $hide)'));
            },
        },
        {
            name: 'skip() collects the boolean variable',
            run() {
                const $hide = v.boolean('hide');
                const node = skip($hide, t.string());
                assert(node.vars.some(vr => vr.varName === 'hide'));
            },
        },
        {
            name: 'skip() parse returns undefined when data is undefined',
            run() {
                const $hide = v.boolean('hide');
                const node = skip($hide, t.string());
                assertEqual(node.parse(undefined), undefined);
                assertEqual(node.parse('hello'), 'hello');
            },
        },
        {
            name: 'include() generates @include directive',
            run() {
                const $show = v.boolean('show');
                const node = select({
                    email: include($show, t.string()),
                });
                assert(node.fragment.includes('email @include(if: $show)'));
            },
        },
        {
            name: 'include() parse returns undefined when data is undefined',
            run() {
                const $show = v.boolean('show');
                const node = include($show, t.string());
                assertEqual(node.parse(undefined), undefined);
                assertEqual(node.parse('hello'), 'hello');
            },
        },

        // ============================================================
        // union()
        // ============================================================

        {
            name: 'union() generates __typename + ... on fragments',
            run() {
                const node = union({
                    User: select({ name: t.string() }),
                    Post: select({ title: t.string() }),
                });
                assert(node.fragment.includes('__typename'));
                assert(node.fragment.includes('... on User { name }'));
                assert(node.fragment.includes('... on Post { title }'));
            },
        },
        {
            name: 'union() parses by __typename',
            run() {
                const node = union({
                    User: select({ name: t.string() }),
                    Post: select({ title: t.string() }),
                });
                const user = node.parse({ __typename: 'User', name: 'Alice' });
                assertEqual(user.__typename, 'User');
                assertEqual((user as any).name, 'Alice');

                const post = node.parse({ __typename: 'Post', title: 'Hello' });
                assertEqual(post.__typename, 'Post');
                assertEqual((post as any).title, 'Hello');
            },
        },
        {
            name: 'union() rejects missing __typename',
            run() {
                const node = union({
                    User: select({ name: t.string() }),
                });
                assertThrows(() => node.parse({ name: 'Alice' }));
            },
        },
        {
            name: 'union() rejects unknown __typename',
            run() {
                const node = union({
                    User: select({ name: t.string() }),
                });
                try {
                    node.parse({ __typename: 'Admin', name: 'Alice' });
                    assert(false);
                } catch (e) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        assert(e.message.includes('"Admin"'));
                        assert(e.message.includes('User'));
                    }
                }
            },
        },
        {
            name: 'union() rejects null',
            run() {
                const node = union({ User: select({ name: t.string() }) });
                assertThrows(() => node.parse(null));
            },
        },
        {
            name: 'union() collects vars from all branches',
            run() {
                const node = union({
                    User: select({ posts: field({ limit: v.int('limit') }, list(select({ id: t.id() }))) }),
                    Post: select({ id: t.id() }),
                });
                assert(node.vars.some(vr => vr.varName === 'limit'));
            },
        },

        // ============================================================
        // lazy()
        // ============================================================

        {
            name: 'lazy() defers resolution',
            run() {
                let resolved = false;
                const node = lazy(() => {
                    resolved = true;
                    return t.string();
                });
                assert(!resolved, 'should not resolve eagerly');
                // Access triggers resolution
                assertEqual(node.parse('hello'), 'hello');
                assert(resolved);
            },
        },
        {
            name: 'lazy() fragment resolves on access',
            run() {
                const node = lazy(() => select({ id: t.id() }));
                assertEqual(node.fragment, '{ id }');
            },
        },
        {
            name: 'lazy() caches resolution',
            run() {
                let count = 0;
                const node = lazy(() => {
                    count++;
                    return t.string();
                });
                node.parse('a');
                node.parse('b');
                void node.fragment;
                assertEqual(count, 1);
            },
        },

        // ============================================================
        // Variables — v namespace
        // ============================================================

        {
            name: 'v.string() creates String! variable',
            run() {
                const vr = v.string('name');
                assertEqual(vr.varName, 'name');
                assertEqual(vr.graphqlType, 'String!');
            },
        },
        {
            name: 'v.int() creates Int! variable',
            run() {
                assertEqual(v.int('page').graphqlType, 'Int!');
            },
        },
        {
            name: 'v.float() creates Float! variable',
            run() {
                assertEqual(v.float('price').graphqlType, 'Float!');
            },
        },
        {
            name: 'v.boolean() creates Boolean! variable',
            run() {
                assertEqual(v.boolean('active').graphqlType, 'Boolean!');
            },
        },
        {
            name: 'v.id() creates ID! variable',
            run() {
                assertEqual(v.id('userId').graphqlType, 'ID!');
            },
        },
        {
            name: 'nullable variable types omit !',
            run() {
                assertEqual(v.nullString('s').graphqlType, 'String');
                assertEqual(v.nullInt('i').graphqlType, 'Int');
                assertEqual(v.nullFloat('f').graphqlType, 'Float');
                assertEqual(v.nullBoolean('b').graphqlType, 'Boolean');
                assertEqual(v.nullId('id').graphqlType, 'ID');
            },
        },
        {
            name: 'v.custom() creates arbitrary variable',
            run() {
                const vr = v.custom<'filter', { name: string }>('filter', 'FilterInput!');
                assertEqual(vr.varName, 'filter');
                assertEqual(vr.graphqlType, 'FilterInput!');
            },
        },

        // ============================================================
        // query() — operation builder
        // ============================================================

        {
            name: 'query() generates query string with no vars',
            run() {
                const q = query('GetUsers', {
                    users: list(select({ id: t.id(), name: t.string() })),
                });
                assertEqual(q.query, 'query GetUsers { users { id name } }');
            },
        },
        {
            name: 'query() generates variable declarations',
            run() {
                const q = query('GetUser', {
                    user: field({ id: v.id('userId') }, select({ name: t.string() })),
                });
                assertEqual(q.query, 'query GetUser($userId: ID!) { user(id: $userId) { name } }');
            },
        },
        {
            name: 'query() deduplicates variables',
            run() {
                const q = query('Q', {
                    a: field({ id: v.id('id') }, select({ name: t.string() })),
                    b: field({ id: v.id('id') }, select({ title: t.string() })),
                });
                // $id should appear only once in the declaration
                const matches = q.query.match(/\$id: ID!/g);
                assertEqual(matches!.length, 1);
            },
        },
        {
            name: 'query() parses response data',
            run() {
                const q = query('Q', {
                    user: select({ name: t.string() }),
                });
                const result = q.parse({ user: { name: 'Alice' } });
                assertEqual(result.user.name, 'Alice');
            },
        },
        {
            name: 'query() with multiple variable types',
            run() {
                const q = query('Search', {
                    search: field(
                        { text: v.string('text'), limit: v.nullInt('limit') },
                        list(select({ id: t.id() })),
                    ),
                });
                assert(q.query.includes('$text: String!'));
                assert(q.query.includes('$limit: Int'));
                // Non-null Int should not have !
                assert(!q.query.includes('$limit: Int!'));
            },
        },

        // ============================================================
        // mutation()
        // ============================================================

        {
            name: 'mutation() generates mutation operation',
            run() {
                const m = mutation('CreateUser', {
                    createUser: field(
                        { name: v.string('name') },
                        select({ id: t.id() }),
                    ),
                });
                assert(m.query.startsWith('mutation CreateUser'));
                assert(m.query.includes('$name: String!'));
            },
        },

        // ============================================================
        // subscription()
        // ============================================================

        {
            name: 'subscription() generates subscription operation',
            run() {
                const s = subscription('OnMessage', {
                    messageAdded: select({
                        id: t.id(),
                        text: t.string(),
                    }),
                });
                assert(s.query.startsWith('subscription OnMessage'));
                assert(s.query.includes('messageAdded { id text }'));
            },
        },

        // ============================================================
        // Complex / integration queries
        // ============================================================

        {
            name: 'deeply nested query with all features',
            run() {
                const q = query('Complex', {
                    users: field(
                        { page: v.int('page'), filter: v.custom<'filter', { name: string }>('filter', 'UserFilter!') },
                        nullable(select({
                            info: select({
                                count: t.int(),
                                pages: t.int(),
                            }),
                            results: nullable(list(select({
                                id: t.id(),
                                name: t.string(),
                                status: t.enum('active', 'inactive'),
                                friends: list(select({
                                    id: t.id(),
                                    name: t.string(),
                                })),
                            }))),
                        })),
                    ),
                });

                // Fragment structure
                assert(q.query.includes('$page: Int!'));
                assert(q.query.includes('$filter: UserFilter!'));
                assert(q.query.includes('users(page: $page, filter: $filter)'));
                assert(q.query.includes('info { count pages }'));
                assert(q.query.includes('friends { id name }'));

                // Parse null top-level
                const nullResult = q.parse({ users: null });
                assertEqual(nullResult.users, null);

                // Parse full result
                const result = q.parse({
                    users: {
                        info: { count: 2, pages: 1 },
                        results: [
                            { id: '1', name: 'Alice', status: 'active', friends: [{ id: '2', name: 'Bob' }] },
                            { id: '2', name: 'Bob', status: 'inactive', friends: [] },
                        ],
                    },
                });
                assertEqual(result.users!.info.count, 2);
                assertEqual(result.users!.results![0]!.name, 'Alice');
                assertEqual(result.users!.results![0]!.status, 'active');
                assertEqual(result.users!.results![0]!.friends[0]!.name, 'Bob');
                assertEqual(result.users!.results![1]!.friends.length, 0);
            },
        },
        {
            name: 'query with union inside list',
            run() {
                const q = query('Feed', {
                    feed: list(union({
                        TextPost: select({ body: t.string() }),
                        ImagePost: select({ url: t.string(), alt: nullable(t.string()) }),
                    })),
                });

                assert(q.query.includes('... on TextPost { body }'));
                assert(q.query.includes('... on ImagePost { url alt }'));

                const result = q.parse({
                    feed: [
                        { __typename: 'TextPost', body: 'Hello' },
                        { __typename: 'ImagePost', url: 'img.png', alt: null },
                    ],
                });
                assertEqual(result.feed.length, 2);
                assertEqual(result.feed[0]!.__typename, 'TextPost');
                assertEqual((result.feed[0] as any).body, 'Hello');
                assertEqual(result.feed[1]!.__typename, 'ImagePost');
                assertEqual((result.feed[1] as any).url, 'img.png');
                assertEqual((result.feed[1] as any).alt, null);
            },
        },
        {
            name: 'query with aliases and raw args',
            run() {
                const userSel = select({ id: t.id(), name: t.string() });
                const q = query('TwoUsers', {
                    first: alias('user', field({ id: raw('"1"') }, userSel)),
                    second: alias('user', field({ id: raw('"2"') }, userSel)),
                });
                assert(q.query.includes('first: user(id: "1")'));
                assert(q.query.includes('second: user(id: "2")'));
                // No variables since all args are raw
                assert(!q.query.includes('$'));

                const result = q.parse({
                    first: { id: '1', name: 'Alice' },
                    second: { id: '2', name: 'Bob' },
                });
                assertEqual(result.first.name, 'Alice');
                assertEqual(result.second.name, 'Bob');
            },
        },
        {
            name: 'query with skip and include directives',
            run() {
                const $showEmail = v.boolean('showEmail');
                const $hideAge = v.boolean('hideAge');
                const q = query('GetUser', {
                    user: select({
                        name: t.string(),
                        email: include($showEmail, t.string()),
                        age: skip($hideAge, t.int()),
                    }),
                });
                assert(q.query.includes('$showEmail: Boolean!'));
                assert(q.query.includes('$hideAge: Boolean!'));
                assert(q.query.includes('email @include(if: $showEmail)'));
                assert(q.query.includes('age @skip(if: $hideAge)'));

                // Parse with fields present
                const full = q.parse({ user: { name: 'Alice', email: 'a@b.c', age: 30 } });
                assertEqual(full.user.name, 'Alice');
                assertEqual(full.user.email, 'a@b.c');
                assertEqual(full.user.age, 30);

                // Parse with skipped/excluded fields
                const partial = q.parse({ user: { name: 'Alice', email: undefined, age: undefined } });
                assertEqual(partial.user.email, undefined);
                assertEqual(partial.user.age, undefined);
            },
        },

        // ============================================================
        // Error types
        // ============================================================

        {
            name: 'ParseError has correct name',
            run() {
                const e = new ParseError('bad data');
                assertEqual(e.name, 'ParseError');
                assertEqual(e.message, 'bad data');
                assert(e instanceof Error);
            },
        },
        {
            name: 'GraphQLError joins messages',
            run() {
                const e = new GraphQLError([
                    { message: 'Field not found' },
                    { message: 'Auth required' },
                ]);
                assertEqual(e.name, 'GraphQLError');
                assert(e.message.includes('Field not found'));
                assert(e.message.includes('Auth required'));
                assertEqual(e.errors.length, 2);
            },
        },

        // ============================================================
        // Edge cases
        // ============================================================

        {
            name: 'select() with nullable nested object',
            run() {
                const node = select({
                    user: nullable(select({
                        origin: nullable(select({
                            name: t.string(),
                        })),
                    })),
                });
                // null at each level
                assertEqual(node.parse({ user: null }).user, null);
                assertEqual(node.parse({ user: { origin: null } }).user!.origin, null);
                assertEqual(node.parse({ user: { origin: { name: 'Earth' } } }).user!.origin!.name, 'Earth');
            },
        },
        {
            name: 'list of nullable items parsed correctly',
            run() {
                const node = list(nullable(select({ id: t.id() })));
                const result = node.parse([{ id: '1' }, null, { id: '3' }]);
                assertEqual(result[0]!?.id, '1');
                assertEqual(result[1]!, null);
                assertEqual(result[2]!?.id, '3');
            },
        },
        {
            name: 'empty select() works',
            run() {
                const node = select({});
                assertEqual(node.fragment, '{  }');
                const result = node.parse({});
                assert(typeof result === 'object');
            },
        },
        {
            name: 'field() with mixed raw and variable args',
            run() {
                const node = select({
                    users: field(
                        { type: raw('"admin"'), limit: v.int('limit') },
                        list(select({ id: t.id() })),
                    ),
                });
                assert(node.fragment.includes('type: "admin"'));
                assert(node.fragment.includes('limit: $limit'));
                // Only the variable should be collected
                assertEqual(node.vars.length, 1);
                assertEqual(node.vars[0]!.varName, 'limit');
            },
        },
        {
            name: 'deeply nested parse error path',
            run() {
                const q = query('Q', {
                    users: list(select({
                        posts: list(select({
                            tags: list(t.string()),
                        })),
                    })),
                });
                try {
                    q.parse({
                        users: [{
                            posts: [{
                                tags: ['ok', 42],
                            }],
                        }],
                    });
                    assert(false, 'should throw');
                } catch (e) {
                    assert(e instanceof ParseError);
                    if (e instanceof ParseError) {
                        // Should contain the path through the tree
                        assert(e.message.includes('users:'));
                        assert(e.message.includes('posts:'));
                        assert(e.message.includes('tags:'));
                        assert(e.message.includes('[1]'));
                    }
                }
            },
        },
        {
            name: 'variables from nested fields are collected at operation level',
            run() {
                const q = query('Q', {
                    users: field({ page: v.int('page') },
                        list(select({
                            posts: field({ limit: v.int('limit') },
                                list(select({ id: t.id() })),
                            ),
                        })),
                    ),
                });
                assert(q.query.includes('$page: Int!'));
                assert(q.query.includes('$limit: Int!'));
            },
        },
        {
            name: 'fragment preserves field order',
            run() {
                const node = select({
                    z: t.string(),
                    a: t.string(),
                    m: t.string(),
                });
                // Object.entries order should be preserved
                assertEqual(node.fragment, '{ z a m }');
            },
        },

        // ============================================================
        // Metadata forwarding through wrappers
        // ============================================================

        {
            name: 'nullable(skip(...)) preserves @skip directive',
            run() {
                const $hide = v.boolean('hide');
                const node = select({ email: nullable(skip($hide, t.string())) });
                assert(node.fragment.includes('email @skip(if: $hide)'));
            },
        },
        {
            name: 'nullable(alias(...)) preserves alias',
            run() {
                const node = select({ myField: nullable(alias('realName', t.string())) });
                assert(node.fragment.includes('myField: realName'));
            },
        },
        {
            name: 'list(field(...)) preserves args',
            run() {
                const node = select({
                    items: list(field({ limit: v.int('n') }, list(select({ id: t.id() })))),
                });
                assert(node.fragment.includes('items(limit: $n)'));
            },
        },
        {
            name: 'nullable(directive(...)) preserves directive',
            run() {
                const node = select({ name: nullable(directive('@deprecated', t.string())) });
                assert(node.fragment.includes('name @deprecated'));
            },
        },
        {
            name: 'lazy() forwards metadata',
            run() {
                const $h = v.boolean('h');
                const node = select({ name: lazy(() => skip($h, t.string())) });
                assert(node.fragment.includes('name @skip(if: $h)'));
            },
        },
        {
            name: 'nullable(list(field(...))) deeply wrapped preserves args',
            run() {
                const node = select({
                    users: nullable(list(field({ page: v.int('p') }, select({ id: t.id() })))),
                });
                assert(node.fragment.includes('users(page: $p)'));
            },
        },
        {
            name: 'stacked directives are concatenated',
            run() {
                const $a = v.boolean('a');
                const $b = v.boolean('b');
                const node = select({ email: skip($a, include($b, t.string())) });
                assert(node.fragment.includes('@skip(if: $a)'));
                assert(node.fragment.includes('@include(if: $b)'));
            },
        },
        {
            name: 'union() does not mutate branch parse result',
            run() {
                const branch = select({ name: t.string() });
                const u = union({ User: branch });
                const data = { __typename: 'User', name: 'Alice' };
                u.parse(data);
                const branchResult = branch.parse(data);
                assert(!('__typename' in branchResult));
            },
        },
    ],
};
