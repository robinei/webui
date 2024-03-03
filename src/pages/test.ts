import { errorDescription, asyncDelay } from '../util';
import { Observable, Signal } from '../observable'
import { FragmentItem,
    HTML, If, Repeat, Immediate, ErrorBoundary, Lazy, Async, Match, Else, Component } from '../core';

const { span, br, button, table, tr, td, input, pre, b, p } = HTML;


export function TestPage(): FragmentItem {
    return ErrorBoundary(ErrorFallback, function tryTestComponent() {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        let width = new Signal(15);
        let height = new Signal(10);
        let scale = new Signal(1);

        return [
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
                    Immediate(
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
            
            'Width: ', Slider(width, 1, 20),
            p(Match(width,
                [x=>(x%2)==0, 'Width (', width,') is ', 'even'],
                [Else, 'Width (', width,') is ', 'odd'])),
            'Height: ', Slider(height, 1, 20),
            'Scale: ', Slider(scale, 1, 10),
            table(
                Repeat(height, y =>
                    tr(
                        Repeat(width, x =>
                            td(()=>((x+1)*(y+1)*scale.get()).toString()))))),
        ];

        function Slider(value: Signal<number>, min: number, max: number) {
            return input({
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: () => value.get().toString(),
                oninput(ev) {
                    value.set((ev.target as any).value);
                }
            });
        }

        function CheckBox(): [Component<HTMLInputElement>, Observable<boolean>] {
            const signal = new Signal(false);
            const cb = input({
                type: 'checkbox',
                onchange()  {
                    signal.set(cb.node.checked);
                },
            });
            return [cb, signal];
        }
    });
}

function ErrorFallback(error: unknown, reset: () => void): FragmentItem {
    return [
        pre(errorDescription(error)),
        button('Reset', { onclick: reset })
    ];
}
