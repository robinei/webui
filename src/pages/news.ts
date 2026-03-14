import { HTML, For, type FragmentItem, Suspense, With, When, type DeepReadonly } from '../core';
import { Outlet } from '../routing';
import { css } from '../css';
import { newsRoute, newsPostRoute } from '..';
import { Query, createQueryFamily } from '../query';

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

async function fetchFrontPage(): Promise<HNHit[]> {
    const res = await fetch(HN_API);
    const data = await res.json();
    return data.hits;
}

async function fetchPost(id: number): Promise<HNPost> {
    const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`);
    return res.json();
}

// Global queries — shared cache, signals accessible anywhere
const frontPageQuery = new Query('hn-front-page', fetchFrontPage, { staleTime: 5_000 });
const postQuery = createQueryFamily('hn-post', fetchPost, { staleTime: 5_000 });

const s = css({
    container: {
        maxWidth: '800px',
        width: '100%',
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
    return div(
        frontPageQuery.bind(),
        button('Refresh', {
            className: s.refreshBtn,
            async onclick() {
                await frontPageQuery.refetch();
                this.updateRoot();
            },
        }),
        For(
            () => frontPageQuery.data.get() ?? [],
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
    const q = postQuery.bind(id);

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
        q,
        newsRoute.Link({}, '\u2190 Back'),
        div({ className: s.postTitle }, () => q.data.get()?.title ?? ''),
        When(() => !!(q.data.get()?.url), a({
            href: () => q.data.get()!.url!,
            target: '_blank',
            rel: 'noopener',
        }, () => q.data.get()!.url!)),
        div({ className: s.postMeta },
            span(() => `${q.data.get()?.points ?? 0} points`),
            ' | ',
            span(() => q.data.get()?.author ?? ''),
            ' | ',
            small(() => q.data.get() ? timeAgo(q.data.get()!.created_at) : ''),
        ),
        When(() => !!q.error.get(), div('Error loading post')),
        hr(),
        For(
            () => q.data.get()?.children ?? [],
            child => Comment(child),
            child => child.id,
        ),
    );
}
