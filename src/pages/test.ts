import { errorDescription, asyncDelay } from '../util';
import {
    FragmentItem,
    HTML, If, Repeat, Unsuspense, ErrorBoundary, Lazy, Async, Match, Else, Component
} from '../core';
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

function ErrorFallback(error: unknown, reset: () => void): FragmentItem {
    return [
        pre(errorDescription(error)),
        button('Reset', { onclick: reset })
    ];
}
