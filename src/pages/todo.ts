import { Html, If, Match, For } from '../core';

interface TodoItemModel {
    title: string;
    done: boolean;
}

class TodoListModel {
    private readonly items: TodoItemModel[] = [];

    addItem(title: string) {
        this.items.push({
            title,
            done: false,
        });
        return this;
    }

    setAllDone = () => {
        for (const item of this.items) {
            item.done = true;
        }
        return this;
    };

    setNoneDone = () => {
        for (const item of this.items) {
            item.done = false;
        }
        return this;
    };

    getItems = () => {
        return this.items;
    };
}

const { div, input, br, button } = Html;

function TodoItemView(item: TodoItemModel) {
    return div(
        {
            className: 'todoItem',
            onclick() { item.done = !item.done; },
            style: {
                cursor: 'pointer'
            }
        },
        input({
            type: 'checkbox',
            checked: () => item.done,
            onchange(ev) {
                item.done = (ev.target as any).checked;
            }
        }),
        () => item.title,
        If(() => item.done, ' - Done')
    );
}

function TodoListView(model: TodoListModel) {
    const textInput = input();
    return div(
        'Todo:',
        br(),
        textInput,
        button('Add', {
            onclick() {
                model.addItem(textInput.node.value);
                textInput.node.value = '';
            }
        }),
        br(),
        button('Select none', { onclick: model.setNoneDone }),
        button('Select all', { onclick: model.setAllDone }),
        Match(() => model.getItems().length % 2,
            [0, 'even'],
            [1, 'odd']),
        For(model.getItems, TodoItemView),
    );
}

export function TodoPage() {
    const model = new TodoListModel().addItem('Bake bread').addItem('Clean dishes').addItem('Take out trash').addItem('Buy groceries');
    return TodoListView(model);
}
