import { Html, For } from '../core';
import { Outlet, Link } from '../routing';


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

const { div, hr, br, ul, li, input } = Html;

export function PreferencesPage() {
    return div(
        'Preferences:',
        hr(),
        Outlet(),
        hr(),
    );
}

export function PreferencesListPage() {
    return ul(
        For(() => preferences, pref =>
            li(
                pref.name,
                ': ',
                () => pref.value,
                ' ',
                Link(`/prefs/${pref.name}`, 'edit'),
            )
        )
    );
}

export function EditPreferencePage({name}: { name(): string }) {
    const textInput = input().setAttributes({
        value: () => getPreference(name()),
        oninput() {
            setPreference(name(), textInput.node.value);
        }
    });
    return div(
        'Editing ',
        name,
        br(),
        textInput,
        Link('/prefs', 'done'),
    );
}
