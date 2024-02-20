import { FragmentItem, HTML, If, Match, For, Lazy, When } from '../core';

interface TodoItemModel {
    title: string;
    done: boolean;
}

class TodoListModel {
    private readonly items: TodoItemModel[] = [];

    private editing?: TodoItemModel;

    startEditing(item: TodoItemModel) {
        this.editing = item;
    }

    finishEditing(item: TodoItemModel) {
        if (this.editing === item) {
            this.editing = undefined;
        }
    }

    isEditing(item: TodoItemModel) {
        return this.editing === item;
    }

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

    hasItems = () => {
        return this.items.length > 0;
    };

    isEmpty = () => {
        return this.items.length === 0;
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

    hasDoneItems = () => {
        for (const item of this.items) {
            if (item.done) {
                return true;
            }
        }
        return false;
    };
}




const { div, input, button, span, h4 } = HTML;

function TodoItemView(item: TodoItemModel, list: TodoListModel) {
    const checkbox = input({
        type: 'checkbox',
        checked: () => item.done,
        onchange(ev) {
            item.done = checkbox.node.checked;
        },
    });

    const isNotEditing = () => !list.isEditing(item);
    const startEditing = () => list.startEditing(item);
    const removeItem = () => list.removeItem(item);

    return div(
        {
            style: {
                display: 'flex',
                alignItems: 'center',
            }
        },
        checkbox,
        If(isNotEditing,
            [
                span(() => item.title, {
                    style: {
                        flexGrow: '1'
                    },
                    onclick: startEditing
                }),
                button('✎', {
                    onclick: startEditing
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
                    onblur: finishEditing
                });

                function finishEditing() {
                    list.finishEditing(item);
                    if (!item.title) {
                        removeItem();
                    }
                }

                return [
                    editField,
                    button('✓', {
                        onclick: finishEditing
                    }),
                ];
            }),
        ),
        button('❌', {
            onclick: removeItem
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
        if (textInput.node.value) {
            list.addItem(textInput.node.value);
            textInput.node.value = '';
        }
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
        ),

        div(
            h4('Todo:', {
                style: {
                    marginTop: '20px',
                    marginBottom: '5px',
                }
            }),
            button('All done!', {
                disabled: list.isAllDone,
                onclick: list.setAllDone,
            }),
            For(list.getPendingItems, item =>
                TodoItemView(item, list))
        ),

        When(list.hasDoneItems, div(
            h4('Done:', {
                style: {
                    marginTop: '20px',
                    marginBottom: '5px',
                }
            }),
            button('Unmark all', {
                disabled: list.isNothingDone,
                onclick: list.setNoneDone,
            }),
            For(list.getDoneItems, item =>
                TodoItemView(item, list))
        )),
    );
}

export function TodoPage(): FragmentItem {
    const model = new TodoListModel().addItem('Bake bread').addItem('Clean dishes').addItem('Take out trash').addItem('Buy groceries');
    return TodoListView(model);
}
