import { type TestSuite, assert } from './runner';
import { deepEqual } from '../../util';
import { parseUrlSpec } from '../../routing';

function testMatch(spec: string, url: string, expectedResult: string | false, expectedArgs: { [key: string]: unknown }): void {
    const matcher = parseUrlSpec(spec);
    const args: { [key: string]: unknown } = {};
    const result = matcher(url, args);
    assert(result === expectedResult, `spec=${spec} url=${url}: expected result ${JSON.stringify(expectedResult)}, got ${JSON.stringify(result)}`);
    assert(deepEqual(args, expectedArgs), `spec=${spec} url=${url}: expected args ${JSON.stringify(expectedArgs)}, got ${JSON.stringify(args)}`);
}

export const routingSuite: TestSuite = {
    name: 'Routing',
    tests: [
        {
            name: 'root spec: matches /',
            run() {
                testMatch('/', '/', '', {});
                testMatch('/', '', '', {});
            },
        },
        {
            name: 'root spec: passes through remainder',
            run() {
                testMatch('/', '/foo', 'foo', {});
            },
        },
        {
            name: 'static path: exact match',
            run() {
                testMatch('/foo', '/foo', '', {});
                testMatch('/foo/', '/foo', '', {});
            },
        },
        {
            name: 'typed param: number',
            run() {
                testMatch('/foo:number', '/123', '', { foo: 123 });
                testMatch('/foo:number', '/nan', false, {});
            },
        },
        {
            name: 'typed param: string',
            run() {
                testMatch('/foo:number/bar:string', '/123/str', '', { foo: 123, bar: 'str' });
            },
        },
        {
            name: 'typed param: with static prefix',
            run() {
                testMatch('/prefix/foo:number/bar:string', '/prefix/123/str', '', { foo: 123, bar: 'str' });
            },
        },
        {
            name: 'typed param: empty segment rejects',
            run() {
                testMatch('/foo/b:boolean', '/foo/', false, {});
                testMatch('/foo/n:number', '/foo/', false, {});
                testMatch('/foo/s:string', '/foo/', false, {});
            },
        },
        {
            name: 'query params: all present',
            run() {
                testMatch('/foo?b:boolean&n:number&s:string', '/foo?b=true&n=123&s=bar', '', { b: true, n: 123, s: 'bar' });
            },
        },
        {
            name: 'query params: partial (optional)',
            run() {
                testMatch('/foo?b:boolean&n:number&s:string', '/foo?b=true', '', { b: true });
            },
        },
        {
            name: 'query params: bare flags',
            run() {
                testMatch('/foo?b:boolean&n:number&s:string', '/foo?b&n&s', '', { b: true, n: 0, s: '' });
            },
        },
        {
            name: 'query params: on root',
            run() {
                testMatch('/?arg:number', '?arg=123', '', { arg: 123 });
                testMatch('/foo/?arg:number', '/foo?arg=123', '', { arg: 123 });
            },
        },
        {
            name: 'wildcard: matches any path',
            run() {
                testMatch('/*', '/foo/bar/baz', '', {});
                testMatch('/*', '/', '', {});
            },
        },
        {
            name: 'wildcard: ignores query string',
            run() {
                testMatch('/*', '/foo?q=1', '', {});
            },
        },
        {
            name: 'wildcard: scoped under prefix',
            run() {
                testMatch('/prefix/*', '/prefix/foo/bar', '', {});
                testMatch('/prefix/*', '/other/foo', false, {});
            },
        },
        {
            name: 'named wildcard: captures remaining path',
            run() {
                testMatch('/rest:*', '/foo/bar/baz', '', { rest: 'foo/bar/baz' });
                testMatch('/rest:*', '/', '', { rest: '' });
            },
        },
        {
            name: 'named wildcard: excludes query string from capture',
            run() {
                testMatch('/rest:*', '/foo?q=1', '', { rest: 'foo' });
            },
        },
    ],
};
