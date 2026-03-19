import { type FragmentItem, HTML, For, When, Context, Component } from '../core';
import { Outlet, createBlocker } from '../routing';
import { prefsRoute, editPrefRoute } from '..';

const { div, hr, br, ul, li, span, input, button } = HTML;

interface Preference {
    readonly name: string;
    value: string;
}

class Preferences {
    items: Preference[] = [
        { name: 'username', value: 'guest' },
        { name: 'password', value: 'guest' },
    ];

    set(name: string, value: string) {
        for (const item of this.items) {
            if (item.name === name) {
                item.value = value;
            }
        }
    }

    get(name: string): string {
        for (const item of this.items) {
            if (item.name === name) {
                return item.value;
            }
        }
        return '';
    }
}

const PreferencesContext = new Context<Preferences>('PreferencesContext');

export function PreferencesPage(): FragmentItem {
    return div(
        'Preferences:',
        hr(),
        Outlet(),
        hr(),
    ).provideContext(PreferencesContext, new Preferences());
}

export function PreferencesListPage(): FragmentItem {
    return PreferencesContext.Consume(prefs => ul(
        For(prefs.items, function renderPrefListEntry(pref) {
            return li(
                pref.name,
                ': ',
                () => pref.value,
                ' ',
                editPrefRoute.Link({ name: pref.name }, 'edit'),
            );
        }, pref => pref.name)
    ));
}

export function EditPreferencePage({ name }: { name(): string }): FragmentItem {
    return PreferencesContext.Consume(prefs => {
        let dirty = false;
        const blocker = createBlocker(() => dirty);

        function save() {
            prefs.set(name(), textInput.node.value);
            dirty = false;
        }

        function cancel() {
            dirty = false;
            prefsRoute.push({});
        }

        const textInput = input({
            value: () => prefs.get(name()),
            oninput() { dirty = true; },
            onkeydown(ev) {
                if (ev.key === 'Enter') {
                    save();
                    prefsRoute.push({});
                }
            },
            onmounted() {
                setTimeout(() => textInput.node.focus(), 25);
            },
        });

        return blocker.connect(div(
            'Editing ',
            name,
            br(),
            textInput,
            ' ',
            button('Save', { onclick() { save(); prefsRoute.push({}); } }),
            ' ',
            button('Cancel', { onclick: cancel }),
            When(() => blocker.isBlocked,
                div(
                    br(),
                    span('Unsaved changes! '),
                    button('Leave', { onclick() { blocker.proceed(); } }),
                    ' ',
                    button('Stay', { onclick() { blocker.reset(); } }),
                ),
            ),
            br(),
            editPrefRoute.Link({ name: 'password' }, 'password'),
            br(),
            editPrefRoute.Link({ name: 'username' }, 'username'),
        ));
    });
}
