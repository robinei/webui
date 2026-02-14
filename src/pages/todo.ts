import { FragmentItem, HTML, If, For, Lazy, When, memoFilter } from '../core';

const { div, input, button, span, h4 } = HTML;


interface TodoItem {
    readonly id: string;
    title: string;
    done: boolean;
}


export function TodoPage(): FragmentItem {
    let idCounter = 0;
    const items: TodoItem[] = [];
    let editing: string | null = null;

    function addItem(title: string) {
        items.push({ id: (idCounter++).toString(), title, done: false });
    }

    function removeItem(item: TodoItem) {
        const i = items.indexOf(item);
        if (i >= 0) items.splice(i, 1);
    }

    addItem('Bake bread');
    addItem('Clean dishes');
    addItem('Take out trash');
    addItem('Buy groceries');

    const todoItems = memoFilter(items, i => !i.done);
    const doneItems = memoFilter(items, i => i.done);

    function TodoItemView(getItem: () => TodoItem): FragmentItem {
        const item = getItem();
        const checkbox = input({
            type: 'checkbox',
            checked: () => item.done,
            onchange() {
                item.done = checkbox.node.checked;
            },
        });

        return div(
            { style: { display: 'flex', alignItems: 'center' } },
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
                                finishEditing();
                            }
                        },
                        onmounted() {
                            setTimeout(() => editField.node.focus(), 0);
                        },
                        onblur: finishEditing,
                    });

                    return [
                        editField,
                        button('✓', {
                            onclick: finishEditing
                        }),
                    ];
                }),
            ),
            button('❌', {
                onclick() { removeItem(item); }
            }),
        );

        function finishEditing() {
            editing = null;
            if (!item.title) {
                removeItem(item);
            }
        }
    }

    const textInput = input({
        style: { flexGrow: '1' },
        oninput() { },
        onkeydown(ev) {
            if (ev.key === 'Enter') {
                onAddText();
            }
        },
        onmounted() {
            setTimeout(() => textInput.node.focus(), 25);
        },
    });

    function onAddText() {
        if (textInput.node.value) {
            addItem(textInput.node.value);
            textInput.node.value = '';
        }
    }

    return div(
        div(
            { style: { display: 'flex' } },
            textInput,
            button('Add', {
                disabled: () => !textInput.node.value,
                onclick: onAddText,
                style: { marginLeft: '10px' },
            }),
        ),

        div(
            h4('Todo:', {
                style: { marginTop: '20px', marginBottom: '5px' },
            }),
            button('All done!', {
                disabled: () => todoItems().length === 0,
                onclick() { items.forEach(i => i.done = true); },
            }),
            For(todoItems, TodoItemView, item => item.id),
        ),

        When(() => doneItems().length > 0, div(
            h4('Done:', {
                style: { marginTop: '20px', marginBottom: '5px' },
            }),
            button('Unmark all', {
                disabled: () => doneItems().length === 0,
                onclick() { items.forEach(i => i.done = false); },
            }),
            For(doneItems, TodoItemView, item => item.id),
        )),
    );
}
