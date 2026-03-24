import { errorDescription, asyncDelay } from '../util';
import {
    type FragmentItem,
    HTML, If, Repeat, Unsuspense, ErrorBoundary, Lazy, Async, Match, Else, Component, Portal, When, For
} from '../core';
import { Signal } from '../observable';
import { css } from '../css';

const { div, span, br, button, table, tr, td, input, pre, b, p } = HTML;

const styles = css({
    styledBox: {
        padding: '12px 18px',
        background: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #3b82f6',
        marginBottom: '12px',
        '&:hover': {
            background: '#334155',
        },
    },
    styledTitle: {
        fontWeight: 'bold',
        color: '#60a5fa',
        fontSize: '14px',
    },
    pulse: {
        display: 'inline-block',
        animation: 'pulse 1.5s ease-in-out infinite',
    },
    '@keyframes pulse': {
        from: { opacity: '1' },
        '50%': { opacity: '0.4' },
        to: { opacity: '1' },
    },
    '@media (max-width: 600px)': {
        styledBox: { padding: '6px 10px' },
    },
});


function ForObservableDemo(): FragmentItem {
    type Tag = { id: number; label: string };
    type Item = { id: number; name: string; score: number; tags: Tag[] };
    let nextId = 4;
    let nextTagId = 10;
    const items = new Signal<Item[]>([
        { id: 1, name: 'Alice', score: 10, tags: [{ id: 1, label: 'admin' }, { id: 2, label: 'user' }] },
        { id: 2, name: 'Bob', score: 7, tags: [{ id: 3, label: 'user' }] },
        { id: 3, name: 'Carol', score: 5, tags: [] },
    ]);
    return div(
        div('For + Observable proxy — fields and nested arrays update independently:'),
        For(items,
            item => div(
                item.name,
                ' — score: ',
                item.score,
                ' [',
                // Nested For: item.tags is SignalProxy<Tag[]> — dispatches to forSignal.
                // Writes from tag render functions cascade back to the root items Signal.
                For(item.tags,
                    tag => span(tag.label, ' '),
                    tag => tag.id,
                ),
                '] ',
                button('+1', {
                    onclick() { item.score.modify(s => s + 1); return false; }
                }),
                ' ',
                button('+tag', {
                    onclick() {
                        item.tags.modify(tags => [...tags, { id: nextTagId++, label: `t${nextTagId}` }]);
                        return false;
                    }
                }),
                ' ',
                button('remove', {
                    onclick() {
                        items.modify(arr => arr.filter(i => i.id !== item.id.get()));
                        return false;
                    }
                }),
            ),
            item => item.id,
        ),
        button('Add item', {
            onclick() { items.modify(arr => [...arr, { id: nextId, name: `Item ${nextId++}`, score: 0, tags: [] }]); },
        }),
    );
}

export function TestPage(): FragmentItem {
    return ErrorBoundary(ErrorFallback, function tryTestComponent() {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        let width = 15;
        let height = 10;
        let scale = 1;
        let highlight = false;

        return [
            ForObservableDemo(),
            PortalDemo(),

            div({ className: styles.styledBox },
                span({ className: styles.styledTitle }, 'css() demo'),
                span(' — scoped class-based styles '),
                span({ className: styles.pulse }, '\u2B24'),
            ),
            div({
                className: () => highlight ? styles.styledBox : '',
                style: { marginBottom: '12px' },
            },
                button('Toggle highlight', {
                    onclick() { highlight = !highlight; this.updateRoot(); },
                }),
            ),

            cb1, cb2, cb3, cb4,
            If(checked1,
                span('a')),
            If(checked2,
                If(checked3,
                    span('b'),
                    span('c'))),
            If(checked4,
                span('d')),

            br(),
            button('Fail', {
                onclick() {
                    throw new Error('test error');
                }
            }),
            br(),

            Lazy(async () => {
                await asyncDelay(500);
                return [
                    'Loaded 1',
                    br(),
                    Unsuspense(
                        [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300].map(t => Async(asyncDelay(t).then(() => b(`${t},`)))),
                    ),
                    br(),
                ];
            }),
            Lazy(() => {
                return ['Loaded 2', br()];
            }),
            Async(asyncDelay(500).then(() => 'Async text')),
            br(),

            'Width: ', Slider(() => width, 1, 20, v => width = v),
            p(Match(() => width,
                [x => (x % 2) == 0, 'Width (', () => width, ') is ', 'even'],
                [Else, 'Width (', () => width, ') is ', 'odd'])),
            'Height: ', Slider(() => height, 1, 20, v => height = v),
            'Scale: ', Slider(() => scale, 1, 10, v => scale = v),
            table(
                Repeat(() => height, y =>
                    tr(
                        Repeat(() => width, x =>
                            td(() => ((x + 1) * (y + 1) * scale)))))),
        ];

        function Slider(value: () => number, min: number, max: number, setValue: (newValue: number) => void) {
            return input({
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: () => value().toString(),
                oninput(ev) {
                    setValue((ev.target as any).value);
                }
            });
        }

        function CheckBox(): [Component<HTMLInputElement>, () => boolean] {
            const cb = input({
                type: 'checkbox',
                onchange() { },
            });
            return [cb, () => cb.node.checked];
        }
    });
}

const modalStyles = css({
    overlay: {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '1000',
        transition: 'opacity 0.35s ease',
        '@starting-style': {
            opacity: '0',
        },
    },
    modal: {
        background: '#1e293b',
        border: '1px solid #3b82f6',
        borderRadius: '10px',
        padding: '24px 32px',
        minWidth: '260px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
        '@starting-style': {
            opacity: '0',
            transform: 'translate(-50%,-50%) scale(0.95)',
        },
    },
    title: {
        fontWeight: 'bold',
        fontSize: '16px',
        marginBottom: '12px',
        color: '#60a5fa',
    },
});

function PortalDemo(): FragmentItem {
    let open = false;
    let count = 0;

    return [
        div({ style: { marginBottom: '12px' } },
            span({ style: { fontWeight: 'bold', color: '#60a5fa', fontSize: '14px' } }, 'Portal demo'),
            span(' — modal rendered into document.body'),
            br(),
            button('Open modal', { onclick() { open = true; } }),
        ),
        When(() => open,
            Portal(document.body,
                div({
                    className: modalStyles.overlay,
                    onclick() { open = false; },
                    onexit(done) {
                        this.node.style.opacity = '0';
                        this.node.addEventListener('transitionend', done, { once: true });
                        setTimeout(done, 450);
                    },
                }),
                div({
                    className: modalStyles.modal,
                    style: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: '1001' },
                    onclick(ev) { ev.stopPropagation(); },
                    onexit(done) {
                        this.node.style.opacity = '0';
                        this.node.style.transform = 'translate(-50%,-50%) scale(0.95)';
                        this.node.addEventListener('transitionend', done, { once: true });
                        setTimeout(done, 450);
                    },
                },
                    div({ className: modalStyles.title }, 'Portal modal (two top-level children)'),
                    p('Count: ', () => count),
                    button('Increment', { onclick() { count++; } }),
                    ' ',
                    button('Close', { onclick() { open = false; } }),
                ),
            ),
        ),
    ];
}

function ErrorFallback(error: unknown, reset: () => void): FragmentItem {
    return [
        pre(errorDescription(error)),
        button('Reset', { onclick: reset })
    ];
}
