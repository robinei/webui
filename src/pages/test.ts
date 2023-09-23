import { errorDescription, asyncDelay } from '../util';
import { Value, mapValue, newProp, Context, Component, FragmentItem,
    Html, With, If, Repeat, Suspense, ErrorBoundary, Lazy } from '../core';

const { span, br, button, table, tr, td, input, pre } = Html;

const TestContext = new Context<string>('TestContext');

export function TestPage(): Component {
    return ErrorBoundary(ErrorFallback, function tryTestComponent() {
        const [cb1, checked1] = CheckBox();
        const [cb2, checked2] = CheckBox();
        const [cb3, checked3] = CheckBox();
        const [cb4, checked4] = CheckBox();

        let width = newProp(15);
        let height = newProp<number>();
        let scale = newProp(1);
        asyncDelay(800).then(() => {
            height(10);
            this.update();
        });

        return Suspense('Loading...',
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
            TestContext.Consume(value => ['Context value: ', value]),
            br(),
            button('Fail', {
                onclick() {
                    throw new Error('test error');
                }
            }),
            br(),

            Lazy(async () => {
                await asyncDelay(500);
                return ['Loaded 1', br()];
            }),
            Lazy(() => {
                return ['Loaded 2', br()];
            }),
            asyncDelay(500).then(() => 'Async text'), br(),
            
            'Width: ', Slider(width, 1, 20), br(),
            'Height: ', Slider(height, 1, 20), br(),
            'Scale: ', Slider(scale, 1, 10), br(),
            table(
                With(scale, s =>
                    Repeat(height, y =>
                        tr(
                            Repeat(width, x =>
                                td(((x+1)*(y+1)*s).toString())))))),
        ).provideContext(TestContext, 'jalla');

        function Slider(value: Value<number>, min: number, max: number) {
            return input({
                type: 'range',
                min: min.toString(),
                max: max.toString(),
                value: mapValue(value, v => v.toString()),
                oninput(ev: Event) {
                    if (typeof value === 'function') {
                        value((ev.target as any).value);
                    }
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
