import { HTML, For, type FragmentItem, Suspense, When } from '../core';
import { Outlet } from '../routing';
import { css } from '../css';
import { rickRoute, rickCharacterRoute } from '..';
import { createQueryFamily } from '../query';
import { t, v, select, field, list, nullable, query, execute } from '../graphql';

const { div, h2, a, span, button, input, img, h3 } = HTML;

const API = 'https://rickandmortyapi.com/graphql';

// --- GraphQL query definitions ---

const locationFields = select({
    id: t.id(),
    name: t.string(),
});

const GetCharacters = query('GetCharacters', {
    characters: field(
        { page: v.nullInt('page'), filter: v.custom<'filter', { name?: string } | null>('filter', 'FilterCharacter') },
        nullable(select({
            info: select({
                count: t.int(),
                pages: t.int(),
            }),
            results: nullable(list(select({
                id: t.id(),
                name: t.string(),
                status: t.enum('Alive', 'Dead', 'unknown'),
                species: t.string(),
                image: t.string(),
            }))),
        })),
    ),
});

const GetCharacter = query('GetCharacter', {
    character: field({ id: v.id('id') }, nullable(select({
        id: t.id(),
        name: t.string(),
        status: t.enum('Alive', 'Dead', 'unknown'),
        species: t.string(),
        gender: t.string(),
        image: t.string(),
        origin: nullable(locationFields),
        location: nullable(locationFields),
        episode: list(select({
            id: t.id(),
            name: t.string(),
            episode: t.string(),
        })),
    }))),
});

// --- Query families ---

const charactersQuery = createQueryFamily(
    'rick-characters',
    (key: { page: number; name: string }) =>
        execute(API, GetCharacters, { page: key.page, filter: key.name ? { name: key.name } : null }),
    { staleTime: 30_000, cacheKey: k => `${k.page}:${k.name}` },
);

const characterQuery = createQueryFamily(
    'rick-character',
    (id: string) => execute(API, GetCharacter, { id }),
    { staleTime: 60_000 },
);

// --- Styles ---

const s = css({
    container: {
        maxWidth: '900px',
        width: '100%',
        margin: '0 auto',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
    },
    searchInput: {
        padding: '8px 12px',
        fontSize: '1em',
        background: '#1a1a2e',
        color: '#e0e0e0',
        border: '1px solid #333',
        borderRadius: '4px',
        width: '250px',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '16px',
        marginTop: '16px',
    },
    card: {
        background: '#1a1a2e',
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 0.15s',
        '&:hover': { transform: 'scale(1.03)' },
    },
    cardImg: {
        width: '100%',
        display: 'block',
    },
    cardBody: {
        padding: '8px 12px',
    },
    cardName: {
        fontWeight: 'bold',
        fontSize: '0.95em',
    },
    cardMeta: {
        fontSize: '0.8em',
        color: '#888',
        marginTop: '4px',
    },
    statusAlive: { color: '#55cc44' },
    statusDead: { color: '#d63031' },
    statusUnknown: { color: '#888' },
    pagination: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        marginTop: '20px',
    },
    paginationBtn: {
        padding: '6px 14px',
        cursor: 'pointer',
    },
    detail: {
        display: 'flex',
        gap: '24px',
        marginTop: '16px',
    },
    detailImg: {
        width: '300px',
        borderRadius: '8px',
    },
    detailInfo: {
        flex: '1',
    },
    detailField: {
        marginBottom: '8px',
    },
    detailLabel: {
        color: '#888',
        fontSize: '0.85em',
    },
    episodeList: {
        marginTop: '20px',
    },
    episode: {
        padding: '6px 0',
        borderBottom: '1px solid #333',
        fontSize: '0.9em',
    },
    episodeCode: {
        color: '#60a5fa',
        marginRight: '8px',
    },
    backLink: {
        color: '#60a5fa',
        textDecoration: 'none',
        cursor: 'pointer',
        '&:hover': { textDecoration: 'underline' },
    },
});

function statusClass(status: string): string {
    if (status === 'Alive') return s.statusAlive;
    if (status === 'Dead') return s.statusDead;
    return s.statusUnknown;
}

// --- Pages ---

export function RickPage(): FragmentItem {
    return div({ className: s.container },
        div({ className: s.header },
            h2(rickRoute.Link({}, 'Rick and Morty')),
        ),
        Suspense('Loading...', Outlet()),
    );
}

export function RickListPage(): FragmentItem {
    let searchName = '';
    let page = 1;

    const handle = charactersQuery.bind(() => ({ page, name: searchName }));

    return [
        handle,
        input({
            className: s.searchInput,
            placeholder: 'Search characters...',
            oninput() {
                searchName = this.node.value;
                page = 1;
                this.updateRoot();
            },
        }),
        div({ className: s.grid },
            For(
                () => handle.data.get()?.characters?.results ?? [],
                char => rickCharacterRoute.Link({ id: char().id },
                    div({ className: s.card },
                        img({ className: s.cardImg, src: () => char().image, alt: () => char().name }),
                        div({ className: s.cardBody },
                            div({ className: s.cardName }, () => char().name),
                            div({ className: s.cardMeta },
                                span({ className: () => statusClass(char().status) }, () => char().status),
                                ' — ',
                                span(() => char().species),
                            ),
                        ),
                    ),
                ),
                char => char.id,
            ),
        ),
        div({ className: s.pagination },
            button('← Prev', {
                className: s.paginationBtn,
                disabled: () => page <= 1,
                onclick() { page--; this.updateRoot(); },
            }),
            span(() => {
                const pages = handle.data.get()?.characters?.info?.pages ?? 1;
                return `Page ${page} of ${pages}`;
            }),
            button('Next →', {
                className: s.paginationBtn,
                disabled: () => page >= (handle.data.get()?.characters?.info?.pages ?? 1),
                onclick() { page++; this.updateRoot(); },
            }),
        ),
    ];
}

export function RickCharacterPage({ id }: { id(): string }): FragmentItem {
    const handle = characterQuery.bind(id);

    return [
        handle,
        rickRoute.Link({}, a({ className: s.backLink }, '← Back to list')),
        When(() => !!handle.data.get()?.character, div({ className: s.detail },
            img({
                className: s.detailImg,
                src: () => handle.data.get()?.character?.image ?? '',
                alt: () => handle.data.get()?.character?.name ?? '',
            }),
            div({ className: s.detailInfo },
                h2(() => handle.data.get()?.character?.name ?? ''),
                div({ className: s.detailField },
                    span({ className: s.detailLabel }, 'Status: '),
                    span({ className: () => statusClass(handle.data.get()?.character?.status ?? '') },
                        () => handle.data.get()?.character?.status ?? ''),
                ),
                div({ className: s.detailField },
                    span({ className: s.detailLabel }, 'Species: '),
                    span(() => handle.data.get()?.character?.species ?? ''),
                ),
                div({ className: s.detailField },
                    span({ className: s.detailLabel }, 'Gender: '),
                    span(() => handle.data.get()?.character?.gender ?? ''),
                ),
                When(() => !!handle.data.get()?.character?.origin, div({ className: s.detailField },
                    span({ className: s.detailLabel }, 'Origin: '),
                    span(() => handle.data.get()?.character?.origin?.name ?? ''),
                )),
                When(() => !!handle.data.get()?.character?.location, div({ className: s.detailField },
                    span({ className: s.detailLabel }, 'Location: '),
                    span(() => handle.data.get()?.character?.location?.name ?? ''),
                )),
                div({ className: s.episodeList },
                    h3('Episodes'),
                    For(
                        () => handle.data.get()?.character?.episode ?? [],
                        ep => div({ className: s.episode },
                            span({ className: s.episodeCode }, () => ep().episode),
                            span(() => ep().name),
                        ),
                        ep => ep.id,
                    ),
                ),
            ),
        )),
    ];
}
