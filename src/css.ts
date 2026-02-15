type StyleProperties = { [key: string]: string | StyleProperties };
type StyleSheet = { [name: string]: StyleProperties | { [name: string]: StyleProperties } };

const injected = new Set<string>();

type CssResult<T> = { [K in keyof T as
    K extends `@keyframes ${infer Name}` ? Name :
    K extends `@${string}` ? never : K]: string };

export function css<T extends StyleSheet>(sheet: T): CssResult<T> {
    const hash = hashCode(JSON.stringify(sheet)).toString(36);
    const classMap = {} as any;
    let rules = '';

    // First pass: collect @keyframes names so animation values can reference them
    const keyframes = new Map<string, string>();
    for (const name in sheet) {
        if (name.startsWith('@keyframes ')) {
            const kfName = name.slice(11);
            const hashed = `${kfName}-${hash}`;
            classMap[kfName] = hashed;
            keyframes.set(kfName, hashed);
        }
    }

    for (const name in sheet) {
        if (name.startsWith('@keyframes ')) {
            const kfName = name.slice(11);
            let inner = '';
            const blocks = sheet[name] as { [stop: string]: StyleProperties };
            for (const stop in blocks) {
                inner += compileRule(stop, blocks[stop], keyframes);
            }
            rules += `@keyframes ${classMap[kfName]}{${inner}}`;
        } else if (name[0] === '@') {
            // @media, @supports, @container, @layer — wrap inner class rules
            let inner = '';
            const block = sheet[name] as { [name: string]: StyleProperties };
            for (const innerName in block) {
                if (!(innerName in classMap)) classMap[innerName] = `${innerName}-${hash}`;
                inner += compileRule(`.${classMap[innerName]}`, block[innerName], keyframes);
            }
            rules += `${name}{${inner}}`;
        } else {
            classMap[name] = `${name}-${hash}`;
            rules += compileRule(`.${classMap[name]}`, sheet[name] as StyleProperties, keyframes);
        }
    }

    if (typeof document !== 'undefined' && !injected.has(hash)) {
        injected.add(hash);
        const style = document.createElement('style');
        style.textContent = rules;
        document.head.appendChild(style);
    }

    return classMap;
}

function compileRule(selector: string, props: StyleProperties, keyframes: Map<string, string>): string {
    let declarations = '';
    let nested = '';
    for (const key in props) {
        const value = props[key];
        if (typeof value === 'string') {
            const resolved = keyframes.size > 0 && (key === 'animation' || key === 'animationName')
                ? replaceKeyframeRefs(value, keyframes) : value;
            declarations += `${camelToKebab(key)}:${resolved};`;
        } else if (key[0] === '&') {
            nested += compileRule(selector + key.slice(1), value, keyframes);
        } else if (key[0] === '@') {
            nested += `${key}{${compileRule(selector, value, keyframes)}}`;
        } else {
            nested += compileRule(`${selector} ${key}`, value, keyframes);
        }
    }
    let result = '';
    if (declarations) result = `${selector}{${declarations}}`;
    return result + nested;
}

function replaceKeyframeRefs(value: string, keyframes: Map<string, string>): string {
    for (const [name, hashed] of keyframes) {
        value = value.replace(new RegExp(`\\b${name}\\b`, 'g'), hashed);
    }
    return value;
}

function camelToKebab(str: string): string {
    return str.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

function hashCode(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
