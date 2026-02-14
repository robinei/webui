import { Store, FragmentItem, HTML, If, For, Lazy, When } from '../core';

const { div, input, button, span, h4 } = HTML;


interface TodoItem {
    readonly id: string;
    title: string;
    done: boolean;
}


class TodoStore extends Store {
    idCounter = 0;
    items: TodoItem[] = [];
    editing: string | null = null;

    get todoItems() { return this.items.filter(i => !i.done); }
    get doneItems() { return this.items.filter(i => i.done); }

    addItem(title: string) {
        this.items.push({ id: (this.idCounter++).toString(), title, done: false });
    }

    removeItem(item: TodoItem) {
        const i = this.items.indexOf(item);
        if (i >= 0) this.items.splice(i, 1);
    }

    toggleItem(item: TodoItem) {
        item.done = !item.done;
    }

    setItemTitle(item: TodoItem, title: string) {
        item.title = title;
    }

    setEditing(id: string | null) {
        this.editing = id;
    }

    markAllDone() {
        this.items.forEach(i => i.done = true);
    }

    unmarkAll() {
        this.items.forEach(i => i.done = false);
    }
}


export function TodoPage(): FragmentItem {
    const store = TodoStore.create();

    store.addItem('Bake bread');
    store.addItem('Clean dishes');
    store.addItem('Take out trash');
    store.addItem('Buy groceries');

    function TodoItemView(getItem: () => TodoItem): FragmentItem {
        const item = getItem();
        const checkbox = input({
            type: 'checkbox',
            checked: () => item.done,
            onchange() {
                store.toggleItem(item);
            },
        });

        return div(
            { style: { display: 'flex', alignItems: 'center' } },
            checkbox,
            If(() => store.editing !== item.id,
                [
                    span(() => item.title, {
                        style: { flexGrow: '1' },
                        onclick() { store.setEditing(item.id); }
                    }),
                    button('✎', {
                        onclick() { store.setEditing(item.id); }
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
                            store.setItemTitle(item, (ev.target as any).value);
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
                onclick() { store.removeItem(item); }
            }),
        );

        function finishEditing() {
            store.setEditing(null);
            if (!item.title) {
                store.removeItem(item);
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
            store.addItem(textInput.node.value);
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
                disabled: () => store.todoItems.length === 0,
                onclick() { store.markAllDone(); },
            }),
            For(() => store.todoItems, TodoItemView, item => item.id),
        ),

        When(() => store.doneItems.length > 0, div(
            h4('Done:', {
                style: { marginTop: '20px', marginBottom: '5px' },
            }),
            button('Unmark all', {
                disabled: () => store.doneItems.length === 0,
                onclick() { store.unmarkAll(); },
            }),
            For(() => store.doneItems, TodoItemView, item => item.id),
        )),
    );
}
