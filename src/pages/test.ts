import { errorDescription, asyncDelay } from '../util';
import { Value, mapValue, FragmentItem,
    HTML, With, If, Repeat, Immediate, ErrorBoundary, Lazy, Async, Loading } from '../core';

const { span, br, button, table, tr, td, input, pre, b } = HTML;


export function TestPage(): FragmentItem {
    return ErrorBoundary(ErrorFallback, function tryTestComponent() {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        let width = 15;
        let height: number | Loading = Loading;
        let scale = 1;
        asyncDelay(800).then(() => {
            height = 10;
            this.update();
        });

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
            
            'Width: ', Slider(()=>width, 1, 20, v=>width=v), br(),
            'Height: ', Slider(()=>height, 1, 20, v=>height=v), br(),
            'Scale: ', Slider(()=>scale, 1, 10, v=>scale=v), br(),
            table(
                With(()=>scale, s =>
                    Repeat(()=>height, y =>
                        tr(
                            Repeat(()=>width, x =>
                                td(((x+1)*(y+1)*s).toString())))))),
        ];

        function Slider(value: Value<number>, min: number, max: number, onChange: (newValue: number) => void) {
            return input({
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: mapValue(value, v => v.toString()),
                oninput(ev) {
                    onChange((ev.target as any).value);
                }
            });
        }

        function CheckBox() {
            const cb = input({ type: 'checkbox', onchange()  { /* empty event handler still triggers update */ } });
            return [cb, () => cb.node.checked] as const;
        }
    });
}

function ErrorFallback(error: unknown, reset: () => void): FragmentItem {
    return [
        pre(errorDescription(error)),
        button('Reset', { onclick: reset })
    ];
}
