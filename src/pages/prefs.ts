import { H, For } from '../core';
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

export function PreferencesPage() {
    return H('div', null,
        'Preferences:',
        H('hr'),
        Outlet(),
        H('hr'),
    );
}

export function PreferencesListPage() {
    return H('ul', null,
        For(() => preferences, pref =>
            H('li', null,
                pref.name,
                ': ',
                () => pref.value,
                ' ',
                Link(`/prefs/${pref.name}`, 'edit'),
            )
        )
    );
}

export function EditPreferencePage({name}: {name: () => string}) {
    const input = H('input', {
        value: () => getPreference(name()),
        oninput() {
            setPreference(name(), input.node.value);
        }
    });
    return H('div', null,
        'Editing ',
        name,
        H('br'),
        input,
        Link('/prefs', 'done'),
    );
}
