import { Component, HTML } from '../../core';

const { div } = HTML;

export interface TestCase {
    name: string;
    run: () => void;
}

export interface TestSuite {
    name: string;
    tests: TestCase[];
}

export interface TestResult {
    name: string;
    status: 'pending' | 'passed' | 'failed';
    error: string | null;
    durationMs: number;
}

export interface SuiteResult {
    name: string;
    results: TestResult[];
    passed: number;
    failed: number;
    durationMs: number;
}

export function runSuite(suite: TestSuite): SuiteResult {
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    const suiteStart = performance.now();

    for (const test of suite.tests) {
        const t0 = performance.now();
        try {
            test.run();
            const t1 = performance.now();
            results.push({ name: test.name, status: 'passed', error: null, durationMs: t1 - t0 });
            passed++;
        } catch (e) {
            const t1 = performance.now();
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ name: test.name, status: 'failed', error: msg, durationMs: t1 - t0 });
            failed++;
        }
    }

    return {
        name: suite.name,
        results,
        passed,
        failed,
        durationMs: performance.now() - suiteStart,
    };
}

// Assertion helpers

export function assert(condition: boolean, message?: string): void {
    if (!condition) {
        throw new Error(message ?? 'assertion failed');
    }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
        throw new Error(message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

export function assertThrows(fn: () => void, message?: string): void {
    try {
        fn();
    } catch {
        return;
    }
    throw new Error(message ?? 'expected function to throw');
}

// DOM sandbox

let testContainer: Component<HTMLDivElement>;

export function setTestContainer(c: Component<HTMLDivElement>) {
    testContainer = c;
}

export function withContainer(fn: (container: Component<HTMLDivElement>) => void): void {
    try {
        fn(testContainer);
    } finally {
        testContainer.clear();
    }
}

export function createContainer(): Component<HTMLDivElement> {
    const c = div();
    testContainer.appendChild(c);
    return c;
}

export function cleanupContainer(c: Component<HTMLDivElement>): void {
    c.removeFromParent();
}
