import { type FragmentItem, HTML, For, When } from '../core';
import { Outlet, createBlocker } from '../routing';
import { prefsRoute, editPrefRoute } from '..';

interface Preference {
    readonly name: string;
    readonly value: string;
}

let preferences: ReadonlyArray<Preference> = [
    { name: 'username', value: 'guest' },
    { name: 'password', value: 'guest' },
];

function findPref(prefs: ReadonlyArray<Preference>, name: string) {
    for (const pref of prefs) {
        if (pref.name === name) {
            return pref;
        }
    }
    return null;
}

function getPreference(prefs: ReadonlyArray<Preference>, name: string) {
    return findPref(prefs, name)?.value ?? '';
}

function setPreference(prefs: ReadonlyArray<Preference>, name: string, value: string): Preference[] {
    if (findPref(prefs, name)) {
        return prefs.map(p => p.name !== name ? p : { ...p, value });
    } else {
        return [...prefs, { name, value }];
    }
}


const { div, hr, br, ul, li, span, input, button } = HTML;

export function PreferencesPage(): FragmentItem {
    return div(
        'Preferences:',
        hr(),
        Outlet(),
        hr(),
    );
}

export function PreferencesListPage(): FragmentItem {
    return ul(
        For(preferences, function renderPrefListEntry(pref) {
            return li(
                pref.name,
                ': ',
                pref.value,
                ' ',
                editPrefRoute.Link({ name: pref.name }, 'edit'),
            );
        })
    );
}

export function EditPreferencePage({ name }: { name(): string }): FragmentItem {
    let dirty = false;
    const blocker = createBlocker(() => dirty);

    function save() {
        preferences = setPreference(preferences, name(), textInput.node.value);
        dirty = false;
    }

    function cancel() {
        dirty = false;
        prefsRoute.push({});
    }

    const textInput = input({
        value: () => getPreference(preferences, name()),
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
}
