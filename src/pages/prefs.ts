import { FragmentItem, HTML, For } from '../core';
import { Outlet } from '../routing';
import { prefsRoute, editPrefRoute } from '..';


interface Preference {
    name: string;
    value: string;
}

const preferences: Preference[] = [
    { name: 'username', value: 'guest' },
    { name: 'password', value: 'guest' },
];

function findPref(name: string) {
    for (const pref of preferences) {
        if (pref.name === name) {
            return pref;
        }
    }
    return null;
}

function getPreference(name: string) {
    return findPref(name)?.value ?? '';
}

function setPreference(name: string, value: string) {
    const pref = findPref(name);
    if (pref) {
        pref.value = value;
    } else {
        preferences.push({ name, value });
    }
}

const { div, hr, br, ul, li, input } = HTML;

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
        For(() => preferences, pref =>
            li(
                pref.name,
                ': ',
                () => pref.value,
                ' ',
                editPrefRoute.Link({name: pref.name}, 'edit'),
            )
        )
    );
}

export function EditPreferencePage({name}: { name(): string }): FragmentItem {
    const textInput = input({
        value: () => getPreference(name()),
        oninput() {
            setPreference(name(), textInput.node.value);
        },
        onkeydown(ev) {
            if (ev.key === 'Enter') {
                prefsRoute.push({});
            }
        },
        onmounted() {
            setTimeout(() => textInput.node.focus(), 25);
        },
    });
    return div(
        'Editing ',
        name,
        br(),
        textInput,
        prefsRoute.Link({}, 'done'),
    );
}
