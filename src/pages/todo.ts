import { Html, If, Match, For, Lazy } from '../core';

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

    removeItem(item: TodoItemModel) {
        const i = this.items.indexOf(item);
        if (i >= 0) {
            this.items.splice(i, 1);
        }
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

    getPendingItems = () => {
        return this.items.filter(item => !item.done);
    };

    getDoneItems = () => {
        return this.items.filter(item => item.done);
    };

    isAllDone = () => {
        for (const item of this.items) {
            if (!item.done) {
                return false;
            }
        }
        return true;
    };

    isNothingDone = () => {
        for (const item of this.items) {
            if (item.done) {
                return false;
            }
        }
        return true;
    };
}




const { div, input, button, span, em, h4 } = Html;

function TodoItemView(item: TodoItemModel, list: TodoListModel) {
    let editing = false;
    const checkbox = input({
        type: 'checkbox',
        checked: () => item.done,
        onchange(ev) {
            item.done = checkbox.node.checked;
        },
    });
    return div(
        {
            style: {
                display: 'flex',
                alignItems: 'center',
            }
        },
        checkbox,
        If(() => !editing,
            [
                span({
                    style: {
                        flexGrow: '1'
                    }
                }, () => item.title + (item.done ? ' - done' : '')),
                button('Edit', {
                    onclick() {
                        editing = true;
                    }
                })
            ],
            Lazy(() => [
                input({
                    style: {
                        flexGrow: '1'
                    },
                    value: () => item.title,
                    oninput(ev) {
                        console.log((ev.target as any).value);
                        item.title = (ev.target as any).value;
                    },
                    onkeydown(ev) {
                        if (ev.key === 'Enter') {
                            editing = false;
                        }
                    },
                    onmounted() {
                        setTimeout(() => this.node.focus(), 100);
                    },
                }),
                button('Done', {
                    onclick() {
                        editing = false;
                    }
                }),
            ]),
        ),
        button('❌', {
            onclick() {
                list.removeItem(item);
            }
        }),
    );
}

function TodoListView(list: TodoListModel) {
    const textInput = input({
        style: {
            flexGrow: '1'
        },
        oninput() {
            // do nothing - but presence of handler will trigger updates whenever the text changes (used to control Add button disablement)
        },
        onkeydown(ev) {
            if (ev.key === 'Enter') {
                onAddText();
            }
        },
    });

    function onAddText() {
        list.addItem(textInput.node.value);
        textInput.node.value = '';
    }

    return div(
        div(
            {
                style: {
                    display: 'flex'
                }
            },
            textInput,
            button('Add', {
                disabled: () => !textInput.node.value,
                onclick: onAddText,
                style: {
                    marginLeft: '10px'
                } 
            }),
            button('Mark none as done', {
                onclick: list.setNoneDone,
                style: {
                    marginLeft: '10px'
                }
            }),
            button('Mark all as done', {
                onclick: list.setAllDone,
                style: {
                    marginLeft: '10px'
                }
            }),
        ),

        h4('Todo:', {
            style: {
                marginTop: '20px',
                marginBottom: '5px',
            }
        }),
        div(
            If(list.isAllDone,
                em('All done!'),
                For(list.getPendingItems,
                    (item) => TodoItemView(item, list))
            )
        ),

        h4('Done:', {
            style: {
                marginTop: '20px',
                marginBottom: '5px',
            }
        }),
        div(
            If(list.isNothingDone,
                em('Nothing done!'),
                For(list.getDoneItems,
                    (item) => TodoItemView(item, list))
            )
        ),
    );
}

export function TodoPage() {
    const model = new TodoListModel().addItem('Bake bread').addItem('Clean dishes').addItem('Take out trash').addItem('Buy groceries');
    return TodoListView(model);
}
