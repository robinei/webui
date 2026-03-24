import { memoFilter, type FragmentItem, HTML, If, For, Lazy, When, GlobalCss } from '../core';
import { compileGlobalCss } from '../css';
import { css } from '../css';

const { div, input, button, span, h4, select, option } = HTML;


const s = css({
    todoItem: {
        display: 'flex',
        alignItems: 'center',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        '@starting-style': {
            opacity: '0',
            transform: 'translateY(-10px)',
        },
    },
    section: {
        transition: 'opacity 0.3s ease',
        '@starting-style': {
            opacity: '0',
        },
    },
});

const vtStyles = compileGlobalCss({
    ':root': { viewTransitionName: 'none' },
    '::view-transition-group(*)': { animationDuration: '0.3s' },
});


interface TodoItem {
    readonly id: string;
    title: string;
    done: boolean;
}


export function TodoPage(): FragmentItem {
    let idCounter = 0;
    const items: TodoItem[] = [];
    let editing: string | null = null;

    type SortMode = 'created' | 'alpha-asc' | 'alpha-desc';
    let sortMode: SortMode = 'created';

    const todoItems = memoFilter(items, i => !i.done);
    const doneItems = memoFilter(items, i => i.done);

    function applySortOrder() {
        const cmp = sortMode === 'alpha-asc'
            ? (a: TodoItem, b: TodoItem) => a.title.localeCompare(b.title)
            : sortMode === 'alpha-desc'
            ? (a: TodoItem, b: TodoItem) => b.title.localeCompare(a.title)
            : (a: TodoItem, b: TodoItem) => Number(a.id) - Number(b.id);
        items.sort(cmp);
    }

    function addItem(title: string) {
        items.push({ id: (idCounter++).toString(), title, done: false });
        applySortOrder();
    }

    addItem('Bake bread');
    addItem('Clean dishes');
    addItem('Take out trash');
    addItem('Buy groceries');

    function TodoItemView(getItem: () => TodoItem): FragmentItem {
        const item = getItem();
        const checkbox = input({
            type: 'checkbox',
            checked: () => item.done,
            onchange() {
                return this.withViewTransition(() => {
                    item.done = !item.done;
                });
            },
        });

        return div(
            {
                className: s.todoItem,
                style: { viewTransitionName: `todo-${item.id}` },
            },
            checkbox,
            If(() => editing !== item.id,
                [
                    span(() => item.title, {
                        style: { flexGrow: '1' },
                        onclick() { editing = item.id; }
                    }),
                    button('✎', {
                        onclick() { editing = item.id; }
                    }),
                ],
                Lazy(() => {
                    const editField = input({
                        style: {
                            flexGrow: '1',
                            paddingTop: '5px',
                            paddingBottom: '5px',
                        },
                        value: () => item.title,
                        oninput(ev) {
                            item.title = (ev.target as any).value;
                        },
                        onkeydown(ev) {
                            if (ev.key === 'Enter') {
                                finishEditing.call(this);
                            }
                        },
                        onmounted() {
                            setTimeout(() => editField.node.focus(), 0);
                        },
                        onblur() { finishEditing.call(this); },
                    });

                    return [
                        editField,
                        button('✓', {
                            onclick() { finishEditing.call(this); }
                        }),
                    ];
                }),
            ),
            button('❌', {
                onclick() {
                    return this.withViewTransition(() => {
                        const i = items.indexOf(item);
                        if (i >= 0) items.splice(i, 1);
                    });
                }
            }),
        );

        function finishEditing(this: any) {
            editing = null;
            if (!item.title) {
                const i = items.indexOf(item);
                if (i >= 0) items.splice(i, 1);
            } else {
                applySortOrder();
            }
        }
    }

    const textInput = input({
        style: { flexGrow: '1' },
        oninput() { },
        onkeydown(ev) {
            if (ev.key === 'Enter') {
                onAddText.call(this);
            }
        },
        onmounted() {
            setTimeout(() => textInput.node.focus(), 25);
        },
    });

    function onAddText(this: any): false {
        const title = textInput.node.value;
        if (title) {
            textInput.node.value = '';
            return this.withViewTransition(() => {
                addItem(title);
            });
        }
        return false;
    }

    return div(
        GlobalCss(vtStyles),
        div(
            { style: { display: 'flex' } },
            textInput,
            button('Add', {
                disabled: () => !textInput.node.value,
                onclick() { onAddText.call(this); },
                style: { marginLeft: '10px' },
            }),
        ),

        div(
            div({ style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px', marginBottom: '5px' } },
                h4('Todo:', { style: { margin: '0' } }),
                select(
                    option('Created', { value: 'created' }),
                    option('A → Z', { value: 'alpha-asc' }),
                    option('Z → A', { value: 'alpha-desc' }),
                    {
                        value: () => sortMode,
                        onchange(ev) {
                            return this.withViewTransition(() => {
                                sortMode = (ev.target as HTMLSelectElement).value as SortMode;
                                applySortOrder();
                            });
                        },
                    },
                ),
                button('All done!', {
                    disabled: () => todoItems().length === 0,
                    onclick() {
                        return this.withViewTransition(() => {
                            items.forEach(i => i.done = true);
                        });
                    },
                }),
            ),
            For(todoItems, TodoItemView, item => item.id),
        ),

        When(() => doneItems().length > 0, div({
                className: s.section,
            },
            div({ style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px', marginBottom: '5px' } },
                h4('Done:', { style: { margin: '0' } }),
                button('Unmark all', {
                    disabled: () => doneItems().length === 0,
                    onclick() {
                        return this.withViewTransition(() => {
                            items.forEach(i => i.done = false);
                        });
                    },
                }),
            ),
            For(doneItems, TodoItemView, item => item.id),
        )),
    );
}
