import { FragmentItem, HTML, For } from '../core';
import { Outlet } from '../routing';
import { prefsRoute, editPrefRoute } from '..';


interface Preference {
    readonly name: string;
    readonly value: string;
}

let preferences: Preference[] = [
    { name: 'username', value: 'guest' },
    { name: 'password', value: 'guest' },
];

function findPref(prefs: Preference[], name: string) {
    for (const pref of prefs) {
        if (pref.name === name) {
            return pref;
        }
    }
    return null;
}

function getPreference(prefs: Preference[], name: string) {
    return findPref(prefs, name)?.value ?? '';
}

function setPreference(prefs: Preference[], name: string, value: string): Preference[] {
    if (findPref(prefs, name)) {
        return prefs.map(p => p.name !== name ? p : { ...p, value });
    } else {
        return [...prefs, { name, value }];
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
        value: () => getPreference(preferences, name()),
        oninput() {
            preferences = setPreference(preferences, name(), textInput.node.value);
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
        br(),
        editPrefRoute.Link({name: 'password'}, 'password'),
        br(),
        editPrefRoute.Link({name: 'username'}, 'username'),
    ).addMountListener(() => {
        console.log("MOUNT");
    }).addUnmountListener(() => {
        console.log("UNMOUNT");
    });
}
