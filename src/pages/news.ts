import { Store, HTML, For, type FragmentItem, Suspense, With, When, type DeepReadonly } from '../core';
import { Outlet } from '../routing';
import { css } from '../css';
import { newsRoute, newsPostRoute } from '..';

const { div, h2, a, span, button, small, hr } = HTML;

const HN_API = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';

interface HNHit {
    objectID: string;
    title: string;
    url: string | null;
    author: string;
    points: number;
    num_comments: number;
    created_at: string;
}

interface HNComment {
    id: number;
    author: string | null;
    text: string | null;
    children: HNComment[];
}

interface HNPost {
    title: string;
    url: string | null;
    author: string;
    points: number;
    created_at: string;
    children: HNComment[];
}

class NewsStore extends Store {
    items: HNHit[] = [];

    async refresh() {
        const res = await fetch(HN_API);
        const data = await res.json();
        this.items = data.hits;
    }
}

class PostStore extends Store implements HNPost {
    title = '';
    url: string | null = null;
    author = '';
    points = 0;
    created_at = '';
    children: HNComment[] = [];

    clear() {
        this.title = '';
        this.url = null;
        this.author = '';
        this.points = 0;
        this.created_at = '';
        this.children = [];
    }

    apply(data: HNPost) {
        Object.assign(this, data);
    }
}

async function fetchPost(id: number) {
    const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`);
    return res.json() as Promise<HNPost>;
}

export async function initStores(): Promise<Record<string, unknown>> {
    const res = await fetch(HN_API);
    const data = await res.json();
    return { NewsStore: { items: data.hits } };
}

export async function initPostStores(id: number): Promise<Record<string, unknown>> {
    const data = await fetchPost(id);
    return { PostStore: data };
}

const s = css({
    container: {
        maxWidth: '800px',
        margin: '0 auto',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
    },
    story: {
        padding: '8px 0',
        borderBottom: '1px solid #333',
    },
    title: {
        fontWeight: 'bold',
        color: '#60a5fa',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
    },
    meta: {
        fontSize: '0.85em',
        color: '#888',
        marginTop: '4px',
    },
    refreshBtn: {
        padding: '6px 14px',
        cursor: 'pointer',
    },
    commentsLink: {
        color: '#60a5fa',
        textDecoration: 'none',
        cursor: 'pointer',
        '&:hover': { textDecoration: 'underline' },
    },
    postTitle: {
        fontSize: '1.4em',
        fontWeight: 'bold',
        marginBottom: '8px',
    },
    postMeta: {
        fontSize: '0.9em',
        color: '#888',
        marginBottom: '16px',
    },
    comment: {
        padding: '8px 0 8px 16px',
        borderLeft: '2px solid #333',
        marginTop: '8px',
    },
    commentAuthor: {
        fontWeight: 'bold',
        color: '#60a5fa',
        fontSize: '0.85em',
    },
    commentText: {
        fontSize: '0.9em',
        marginTop: '4px',
        '& a': { color: '#60a5fa' },
        '& p': { margin: '4px 0' },
    },
    deleted: {
        color: '#555',
        fontStyle: 'italic',
    },
});

function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function NewsPage(): FragmentItem {
    return div({ className: s.container },
        div({ className: s.header },
            h2(newsRoute.Link({}, 'Hacker News')),
        ),
        Suspense('Loading...', Outlet()),
    );
}

export function NewsListPage(): FragmentItem {
    const store = NewsStore.create();

    return div(
        button('Refresh', {
            className: s.refreshBtn,
            async onclick() {
                await store.refresh();
            },
        }),
        For(
            () => store.items,
            item => div({ className: s.story },
                a({
                    className: s.title,
                    href: () => item().url ?? `https://news.ycombinator.com/item?id=${item().objectID}`,
                    target: '_blank',
                    rel: 'noopener',
                }, () => item().title),
                div({ className: s.meta },
                    span(() => `${item().points} points`),
                    ' | ',
                    span(() => item().author),
                    ' | ',
                    newsPostRoute.Link({ id: Number(item().objectID) }, span({
                        className: s.commentsLink,
                    }, () => `${item().num_comments} comments`)),
                    ' | ',
                    small(() => timeAgo(item().created_at)),
                ),
            ),
            item => item.objectID,
        ),
    );
}

export function NewsPostPage({ id }: { id(): number }): FragmentItem {
    const store = PostStore.create();

    function Comment(comment: () => DeepReadonly<HNComment>): FragmentItem {
        return With(comment, c => div({ className: s.comment },
            !c.author && !c.text
                ? span({ className: s.deleted }, '[deleted]')
                : [
                    c.author ? span({ className: s.commentAuthor }, c.author) : [],
                    c.text ? div({ className: s.commentText, innerHTML: c.text }) : [],
                ],
            For(() => c.children, child => Comment(child), child => child.id),
        ), 'Comment');
    }

    return div(
        newsRoute.Link({}, '\u2190 Back'),
        div({ className: s.postTitle }, () => store.title),
        When(() => !!store.url, a({ href: () => store.url!, target: '_blank', rel: 'noopener' }, () => store.url!)),
        div({ className: s.postMeta },
            span(() => `${store.points} points`),
            ' | ',
            span(() => store.author),
            ' | ',
            small(() => timeAgo(store.created_at)),
        ),
        hr(),
        For(
            () => store.children,
            child => Comment(child),
            child => child.id,
        ),
    ).addValueLoader(id, async function loadPost(newId) {
        store.clear();
        const data = await fetchPost(newId);
        return () => store.apply(data);
    });
}
