import { FragmentItem, HTML, VirtualList } from '../core';

const { div, h4, span } = HTML;


interface ListItem {
    readonly id: number;
    name: string;
    description: string;
    value: number;
}

const descriptions = [
    'Short.',
    'A medium length description for this particular item.',
    'This is a longer description that demonstrates how items can have varying heights based on their content, which the virtual list handles gracefully.',
];

export function VirtualListPage(): FragmentItem {
    const items: ListItem[] = [];
    for (let i = 0; i < 10000; ++i) {
        items.push({
            id: i,
            name: `Item ${i}`,
            description: descriptions[i % 3],
            value: Math.floor(Math.random() * 1000),
        });
    }

    return [
        h4('Vertical (10,000 variable-height items)'),
        VirtualList({
            items,
            estimateSize: 60,
            render: item => div({
                style: {
                    padding: '8px 12px',
                    borderBottom: '1px solid #eee',
                },
            },
                div({ style: { display: 'flex', justifyContent: 'space-between' } },
                    span(() => item.name, { style: { fontWeight: 'bold' } }),
                    span(() => item.value.toString(), { style: { color: '#888', fontSize: '12px' } }),
                ),
                div(() => item.description, {
                    style: { color: '#666', fontSize: '13px', marginTop: '4px' },
                }),
            ),
            key: item => item.id,
        }).setStyle({ height: '400px' }),

        h4('Horizontal'),
        VirtualList({
            items,
            estimateSize: 120,
            direction: 'horizontal',
            render: item => div({
                style: {
                    width: '120px',
                    height: '100%',
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRight: '1px solid #eee',
                    flexShrink: '0',
                },
            },
                span(() => item.name),
                span(() => item.value.toString(), {
                    style: { color: '#888', fontSize: '12px' },
                }),
            ),
            key: item => item.id,
        }).setStyle({ height: '100px' }),
    ];
}
