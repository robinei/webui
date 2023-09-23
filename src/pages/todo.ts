import { Html, StaticText, If, Match, For } from '../core';

interface TodoItemModel {
    title: string;
    done: boolean;
    index: number;
}

class TodoListModel {
    private readonly items: TodoItemModel[] = [];

    addItem(title: string) {
        this.items.push({
            title,
            done: false,
            index: this.items.length,
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
        input().setAttributes({
            type: 'checkbox',
            checked: () => item.done,
            onchange(ev: Event) {
                item.done = (ev.target as any).checked;
            }
        }),
        () => item.title,
        If(() => item.done, ' - Done')
    ).setAttributes({
        onclick() { item.done = !item.done; },
        style: {
            cursor: 'pointer',
            backgroundColor: () => (item.index % 2) ? '#aaaaaa' : '#ffffff',
        }
    });
}

function TodoListView(model: TodoListModel) {
    const textInput = input();
    return div(
        'Todo:',
        br(),
        textInput,
        button('Add').addEventListener('click', function onClick() {
            model.addItem(textInput.node.value);
            textInput.node.value = '';
        }),
        br(),
        button('Select none').addEventListener('click', model.setNoneDone),
        button('Select all').addEventListener('click', model.setAllDone),
        Match(() => model.getItems().length % 2,
            [0, 'even'],
            [1, StaticText('odd')
                    .addMountListener(() => console.log('odd mounted'))
                    .addUnmountListener(() => console.log('odd unmounted'))]),
        For(model.getItems, TodoItemView),
    );
}

export function TodoPage() {
    const model = new TodoListModel().addItem('Bake bread');
    return TodoListView(model);
}