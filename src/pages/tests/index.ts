import { type FragmentItem, HTML, If, When, For } from '../../core';
import { css } from '../../css';
import { type TestSuite, type SuiteResult, runSuite, setTestContainer } from './runner';
import { componentTreeSuite } from './component-tree';
import { reactivitySuite } from './reactivity';
import { controlFlowSuite } from './control-flow';
import { lifecycleSuite } from './lifecycle';
import { contextErrorsSuite } from './context-errors';
import { utilSuite } from './util';
import { routingSuite } from './routing';
import { observableSuite } from './observable';

const { div, span, button, h2, h3, pre } = HTML;

const s = css({
    page: {
        maxWidth: '800px',
        margin: '0 auto',
        padding: '20px',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '12px',
    },
    title: {
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#e2e8f0',
        margin: '0',
    },
    stats: {
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
    },
    statPassed: {
        color: '#4ade80',
        fontWeight: 'bold',
    },
    statFailed: {
        color: '#f87171',
        fontWeight: 'bold',
    },
    statTotal: {
        color: '#94a3b8',
    },
    runAllBtn: {
        padding: '8px 16px',
        background: '#3b82f6',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        '&:hover': { background: '#2563eb' },
    },
    card: {
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        marginBottom: '12px',
        overflow: 'hidden',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        cursor: 'pointer',
        '&:hover': { background: '#334155' },
    },
    cardLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    },
    expandIcon: {
        color: '#64748b',
        fontSize: '12px',
        width: '16px',
        display: 'inline-block',
        transition: 'transform 0.15s',
    },
    suiteName: {
        fontWeight: 'bold',
        color: '#e2e8f0',
    },
    suiteStats: {
        fontSize: '13px',
        color: '#94a3b8',
    },
    runBtn: {
        padding: '4px 12px',
        background: '#334155',
        color: '#e2e8f0',
        border: '1px solid #475569',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '13px',
        '&:hover': { background: '#475569' },
    },
    testList: {
        borderTop: '1px solid #334155',
        padding: '0',
    },
    testRow: {
        display: 'flex',
        alignItems: 'flex-start',
        padding: '8px 16px 8px 42px',
        gap: '8px',
        borderBottom: '1px solid #1e293b',
    },
    testIcon: {
        width: '18px',
        flexShrink: '0',
        textAlign: 'center',
        lineHeight: '1.4',
    },
    testName: {
        color: '#cbd5e1',
        fontSize: '13px',
        flex: '1',
    },
    testDuration: {
        color: '#64748b',
        fontSize: '12px',
        flexShrink: '0',
    },
    errorMsg: {
        color: '#f87171',
        fontSize: '12px',
        fontFamily: 'monospace',
        padding: '4px 0 0 26px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    },
    passed: { color: '#4ade80' },
    failed: { color: '#f87171' },
    pending: { color: '#64748b' },
    sandbox: {
        position: 'absolute',
        width: '0',
        height: '0',
        overflow: 'hidden',
        opacity: '0',
        pointerEvents: 'none',
    },
});

const allSuites: TestSuite[] = [
    componentTreeSuite,
    reactivitySuite,
    controlFlowSuite,
    lifecycleSuite,
    contextErrorsSuite,
    utilSuite,
    routingSuite,
    observableSuite,
];

export function TestsPage(): FragmentItem {
    let suiteResults: SuiteResult[] = [];
    let expandedSuites = new Set<string>();
    let hasRun = false;

    const totalPassed = () => suiteResults.reduce((s, r) => s + r.passed, 0);
    const totalFailed = () => suiteResults.reduce((s, r) => s + r.failed, 0);
    const totalTests = () => totalPassed() + totalFailed();

    function getSuiteResult(name: string): SuiteResult | undefined {
        return suiteResults.find(r => r.name === name);
    }

    function runAll(this: any) {
        suiteResults = allSuites.map(runSuite);
        hasRun = true;
        this.updateRoot();
    }

    function runOne(this: any, suite: TestSuite) {
        const result = runSuite(suite);
        const idx = suiteResults.findIndex(r => r.name === suite.name);
        if (idx >= 0) {
            suiteResults[idx] = result;
        } else {
            suiteResults.push(result);
        }
        hasRun = true;
        this.updateRoot();
    }

    function toggleExpand(this: any, name: string) {
        if (expandedSuites.has(name)) {
            expandedSuites.delete(name);
        } else {
            expandedSuites.add(name);
        }
        this.updateRoot();
    }

    // Hidden sandbox container for tests to use
    const sandbox = div({ className: s.sandbox, onmounted() { setTestContainer(this); } });

    return div({ className: s.page },
        // Header
        div({ className: s.header },
            h2({ className: s.title }, 'Test Runner'),
            When(() => hasRun,
                div({ className: s.stats },
                    span({ className: s.statPassed }, () => `${totalPassed()} passed`),
                    span({ className: s.statFailed }, () => {
                        const f = totalFailed();
                        return f > 0 ? `${f} failed` : '';
                    }),
                    span({ className: s.statTotal }, () => {
                        const total = totalPassed() + totalFailed();
                        return `${total} total`;
                    }),
                ),
            ),
            button('Run All', {
                className: s.runAllBtn,
                onclick: runAll,
            }),
        ),

        // Suite cards
        ...allSuites.map(suite =>
            div({ className: s.card },
                // Card header
                div({
                    className: s.cardHeader,
                    onclick() { toggleExpand.call(this, suite.name); },
                },
                    div({ className: s.cardLeft },
                        span({ className: s.expandIcon }, () => expandedSuites.has(suite.name) ? '\u25BC' : '\u25B6'),
                        span({ className: s.suiteName }, suite.name),
                        When(() => !!getSuiteResult(suite.name),
                            span({ className: s.suiteStats }, () => {
                                const r = getSuiteResult(suite.name);
                                if (!r) return '';
                                const parts: string[] = [];
                                if (r.passed > 0) parts.push(`${r.passed} passed`);
                                if (r.failed > 0) parts.push(`${r.failed} failed`);
                                parts.push(`${r.durationMs.toFixed(1)}ms`);
                                return parts.join(' \u00B7 ');
                            }),
                        ),
                    ),
                    button('Run', {
                        className: s.runBtn,
                        onclick(ev) {
                            ev.stopPropagation();
                            runOne.call(this, suite);
                        },
                    }),
                ),

                // Expanded test list
                When(() => expandedSuites.has(suite.name) && !!getSuiteResult(suite.name),
                    div({ className: s.testList },
                        ...suite.tests.map((test, i) =>
                            div(
                                div({ className: s.testRow },
                                    span({ className: s.testIcon }, () => {
                                        const r = getSuiteResult(suite.name);
                                        if (!r) return '\u25CB';
                                        const tr = r.results[i];
                                        if (!tr) return '\u25CB';
                                        if (tr.status === 'passed') return '\u2714';
                                        if (tr.status === 'failed') return '\u2718';
                                        return '\u25CB';
                                    }),
                                    span({
                                        className: () => {
                                            const r = getSuiteResult(suite.name);
                                            const tr = r?.results[i];
                                            if (tr?.status === 'passed') return `${s.testName} ${s.passed}`;
                                            if (tr?.status === 'failed') return `${s.testName} ${s.failed}`;
                                            return s.testName;
                                        },
                                    }, test.name),
                                    span({ className: s.testDuration }, () => {
                                        const r = getSuiteResult(suite.name);
                                        const tr = r?.results[i];
                                        if (!tr) return '';
                                        return `${tr.durationMs.toFixed(2)}ms`;
                                    }),
                                ),
                                When(() => {
                                    const r = getSuiteResult(suite.name);
                                    return !!r?.results[i]?.error;
                                },
                                    div({ className: s.errorMsg }, () => {
                                        const r = getSuiteResult(suite.name);
                                        return r?.results[i]?.error ?? '';
                                    }),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        ),

        // Hidden sandbox
        sandbox,
    );
}
