import type { ObjectConfig } from 'sprintster';

type Prop = { name: string; type: string; [k: string]: unknown };

export function object(name: string, route: string, props: Prop[], extra: Record<string, unknown> = {}): ObjectConfig {
  return {
    name,
    title: name,
    titlePlural: name,
    route,
    lifecycle: { softDelete: 'removed' },
    properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, ...props, { name: 'removed', type: 'boolean', system: true }],
    lists: [],
    ...extra,
  } as unknown as ObjectConfig;
}

const slug = { name: 'slug', type: 'text' };

// The scaffolded blog's objects, reduced to what routing and rendering read.
export const blogObjects: ObjectConfig[] = [
  object('page', 'pages', [{ name: 'title', type: 'text' }, slug, { name: 'body', type: 'markdown' }, { name: 'status', type: 'enum', values: ['draft', 'published'] }, { name: 'publishedAt', type: 'datetime' }]),
  object('post', 'posts', [
    { name: 'title', type: 'text' },
    slug,
    { name: 'body', type: 'markdown' },
    { name: 'status', type: 'enum', values: ['draft', 'published'] },
    { name: 'publishedAt', type: 'datetime' },
    { name: 'category', type: 'ref', target: 'category' },
    { name: 'tags', type: 'refs', target: 'tag' },
  ]),
  object('category', 'categories', [{ name: 'name', type: 'text' }, slug]),
  object('tag', 'tags', [{ name: 'name', type: 'text' }, slug]),
  object('asset', 'media', [{ name: 'file', type: 'image' }]),
  object('navItem', 'menu', [{ name: 'label', type: 'text' }, { name: 'page', type: 'ref', target: 'page' }]),
  object('settings', 'settings', [{ name: 'siteTitle', type: 'text' }], { singleton: true, lifecycle: undefined }),
];

export const blogSite = { collections: { page: { path: '/', home: 'home' }, post: { path: '/blog', sort: '-publishedAt' } } };
