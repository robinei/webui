import { FragmentItem, HTML, If, Match, For, Lazy, When } from '../core';

const { div, input, button, span, h4 } = HTML;


interface TodoItemProps {
    getTitle(): string;
    setTitle(title: string): void;
    isDone(): boolean;
    setDone(done: boolean): void;
    isNotEditing(): boolean;
    startEditing(): void;
    removeItem(): void;
}

function TodoItemView(props: TodoItemProps) {
    const checkbox = input({
        type: 'checkbox',
        checked: props.isDone,
        onchange(ev) {
            props.setDone(checkbox.node.checked);
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
        If(props.isNotEditing,
            [
                span(props.getTitle, {
                    style: {
                        flexGrow: '1'
                    },
                    onclick: props.startEditing
                }),
                button('✎', {
                    onclick: props.startEditing
                }),
            ],
            Lazy(() => {
                const editField = input({
                    style: {
                        flexGrow: '1',
                        paddingTop: '5px',
                        paddingBottom: '5px',
                    },
                    value: props.getTitle,
                    oninput(ev) {
                        props.setTitle((ev.target as any).value);
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

                return [
                    editField,
                    button('✓', {
                        onclick: finishEditing
                    }),
                ];
            }),
        ),
        button('❌', {
            onclick: props.removeItem
        }),
    );

    function finishEditing() {
        finishEditing();
        if (!props.getTitle()) {
            props.removeItem();
        }
    }
}


interface TodoListProps {
    getTodoItems(): ReadonlyArray<TodoItem>;
    getDoneItems(): ReadonlyArray<TodoItem>;
    addItem(title: string): void;
    areAllTodo(): boolean;
    areAllDone(): boolean;
    areAnyDone(): boolean;
    setAllTodo(): void;
    setAllDone(): void;
}

function TodoListView(props: TodoListProps) {
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
        onmounted() {
            setTimeout(() => textInput.node.focus(), 25);
        },
    });

    function onAddText() {
        if (textInput.node.value) {
            props.addItem(textInput.node.value);
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
                disabled: props.areAllDone,
                onclick: props.setAllDone,
            }),
            For(props.getTodoItems, getItem => {
                
            }, item => item.id)
        ),

        When(props.areAnyDone, div(
            h4('Done:', {
                style: {
                    marginTop: '20px',
                    marginBottom: '5px',
                }
            }),
            button('Unmark all', {
                disabled: props.areAllTodo,
                onclick: props.setAllTodo,
            }),
            For(props.getDoneItems, TodoItemView)
        )),
    );
}




interface TodoItem {
    readonly id: string;
    readonly title: string;
}

interface TodoList {
    readonly todo: TodoItem[];
    readonly done: TodoItem[];
    readonly idCounter: number;
    readonly editing: string | null;
}

function emptyTodoList(): TodoList {
    return {
        todo: [],
        done: [],
        idCounter: 0,
        editing: null,
    }
}

function setEditing(list: TodoList, itemId: string | null): TodoList {
    return { ...list,
        editing: itemId
    };
}

function addItem(list: TodoList, title: string): TodoList {
    return { ...list,
        todo: [...list.todo, { id: list.idCounter.toString(), title, }],
        idCounter: list.idCounter + 1
    };
}

function removeItem(list: TodoList, itemId: string): TodoList {
    return { ...list,
        todo: list.todo.filter(item => item.id != itemId),
        done: list.done.filter(item => item.id != itemId),
    };
}

function modifyItem(list: TodoList, itemId: string, func: (item: TodoItem) => TodoItem): TodoList {
    return { ...list,
        todo: list.todo.map(item => item.id !== itemId ? item : func(item)),
        done: list.done.map(item => item.id !== itemId ? item : func(item)),
    };
}

function setAllDone(list: TodoList): TodoList {
    return { ...list,
        todo: [],
        done: [...list.todo, ...list.done],
    };
}

function setAllTodo(list: TodoList): TodoList {
    return { ...list,
        todo: [...list.todo, ...list.done],
        done: [],
    };
}


export function TodoPage(): FragmentItem {
    let list: TodoList = emptyTodoList();
    list = addItem(list, 'Bake bread');
    list = addItem(list, 'Clean dishes');
    list = addItem(list, 'Take out trash');
    list = addItem(list, 'Buy groceries');

    return TodoListView({
        getTodoItems() { return list.todo; },
        getDoneItems() { return list.done; },
        addItem(title) { list = addItem(list, title); },
        areAllTodo() { return list.done.length === 0; },
        areAllDone() { return list.todo.length === 0; },
        areAnyDone() { return list.done.length > 0; },
        setAllTodo() { list = setAllTodo(list); },
        setAllDone() { list = setAllDone(list); },
    });
}
