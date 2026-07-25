export interface ScaffoldOptions {
  name: string;
  backend: 'sqlite' | 'postgres';
  overrides?: { sprintster: string; 'sprintster-cms': string };
}

type Property = { name: string; type: string; validation?: Record<string, unknown>; [k: string]: unknown };
export interface CmsObject {
  name: string;
  title: string;
  titlePlural: string;
  lifecycle: unknown;
  properties: Property[];
  lists: unknown[];
  views: unknown[];
}

const standardActions = [
  { hotkey: 'n', label: 'new', kind: 'create', view: 'default' },
  { hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' },
  { hotkey: 'v', label: 'view', kind: 'view', view: 'default' },
  { hotkey: 'd', label: 'del', kind: 'delete' },
];

const pageObject = {
  name: 'page',
  title: 'Page',
  titlePlural: 'Pages',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'status', title: 'Status', type: 'enum', values: ['draft', 'published'], default: 'draft' },
    { name: 'title', title: 'Title', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'slug', title: 'Slug', type: 'text', validation: { required: true, maxLength: 200, unique: true, caseInsensitive: true } },
    { name: 'body', title: 'Body', type: 'markdown', editor: 'combo' },
    { name: 'parent', title: 'Parent', type: 'ref', target: 'page', display: 'title', nullable: true },
    { name: 'order', title: 'Order', type: 'integer', nullable: true },
    { name: 'publishedAt', title: 'Published at', type: 'datetime', nullable: true },
    { name: 'seoTitle', title: 'SEO title', type: 'text', nullable: true },
    { name: 'seoDescription', title: 'SEO description', type: 'text', nullable: true },
    { name: 'ogImage', title: 'OG image', type: 'image', nullable: true },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Pages',
      columns: [
        { property: 'title', label: 'Title', width: 34 },
        { property: 'slug', label: 'Slug', width: 24 },
        { property: 'status', label: 'Status', width: 12 },
        { property: 'publishedAt', label: 'Published', width: 18 },
      ],
      search: { fields: ['title', 'slug'], idPrefix: true },
      filters: [{ property: 'status' }],
      actions: standardActions,
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Page',
      fields: [
        { property: 'title', placeholder: 'e.g. About us' },
        { property: 'slug', placeholder: 'e.g. about' },
        { property: 'status' },
        { property: 'body' },
        { property: 'parent' },
        { property: 'order' },
        { property: 'publishedAt' },
        {
          kind: 'fieldset',
          title: 'SEO',
          fields: [
            { property: 'seoTitle' },
            { property: 'seoDescription', rows: 3 },
            { property: 'ogImage' },
          ],
        },
      ],
    },
  ],
};

const postObject = {
  name: 'post',
  title: 'Post',
  titlePlural: 'Posts',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'status', title: 'Status', type: 'enum', values: ['draft', 'published'], default: 'draft' },
    { name: 'title', title: 'Title', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'slug', title: 'Slug', type: 'text', validation: { required: true, maxLength: 200, unique: true, caseInsensitive: true } },
    { name: 'excerpt', title: 'Excerpt', type: 'text', nullable: true, validation: { maxLength: 500 } },
    { name: 'body', title: 'Body', type: 'markdown', editor: 'combo' },
    { name: 'cover', title: 'Cover image', type: 'image', nullable: true },
    { name: 'category', title: 'Category', type: 'ref', target: 'category', display: 'name', nullable: true },
    { name: 'tags', title: 'Tags', type: 'refs', target: 'tag', display: 'name' },
    { name: 'publishedAt', title: 'Published at', type: 'datetime', nullable: true },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Posts',
      columns: [
        { property: 'title', label: 'Title', width: 34 },
        { property: 'slug', label: 'Slug', width: 24 },
        { property: 'status', label: 'Status', width: 12 },
        { property: 'publishedAt', label: 'Published', width: 18 },
      ],
      search: { fields: ['title', 'slug'], idPrefix: true },
      filters: [{ property: 'status' }],
      actions: standardActions,
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Post',
      fields: [
        { property: 'title', placeholder: 'e.g. Hello world' },
        { property: 'slug', placeholder: 'e.g. hello-world' },
        { property: 'status' },
        { property: 'excerpt', rows: 2, placeholder: 'Short summary for listings' },
        { property: 'cover' },
        { property: 'category' },
        { property: 'tags' },
        { property: 'body' },
        { property: 'publishedAt' },
      ],
    },
  ],
};

const categoryObject = {
  name: 'category',
  title: 'Category',
  titlePlural: 'Categories',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', title: 'Name', type: 'text', validation: { required: true, minLength: 1, maxLength: 100 } },
    { name: 'slug', title: 'Slug', type: 'text', validation: { required: true, maxLength: 100, unique: true, caseInsensitive: true } },
    { name: 'description', title: 'Description', type: 'text', nullable: true, validation: { maxLength: 500 } },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Categories',
      columns: [
        { property: 'name', label: 'Name', width: 30 },
        { property: 'slug', label: 'Slug', width: 30 },
      ],
      search: { fields: ['name', 'slug'], idPrefix: true },
      actions: standardActions,
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Category',
      fields: [
        { property: 'name', placeholder: 'e.g. Engineering' },
        { property: 'slug', placeholder: 'e.g. engineering' },
        { property: 'description', rows: 3 },
      ],
    },
  ],
};

const tagObject = {
  name: 'tag',
  title: 'Tag',
  titlePlural: 'Tags',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', title: 'Name', type: 'text', validation: { required: true, minLength: 1, maxLength: 100 } },
    { name: 'slug', title: 'Slug', type: 'text', validation: { required: true, maxLength: 100, unique: true, caseInsensitive: true } },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Tags',
      columns: [
        { property: 'name', label: 'Name', width: 30 },
        { property: 'slug', label: 'Slug', width: 30 },
      ],
      search: { fields: ['name', 'slug'], idPrefix: true },
      actions: standardActions,
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Tag',
      fields: [
        { property: 'name', placeholder: 'e.g. release-notes' },
        { property: 'slug', placeholder: 'e.g. release-notes' },
      ],
    },
  ],
};

const navItemObject = {
  name: 'navItem',
  title: 'Menu Item',
  titlePlural: 'Menu',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'group', title: 'Menu', type: 'enum', values: ['main', 'footer'], default: 'main' },
    { name: 'label', title: 'Label', type: 'text', validation: { required: true, minLength: 1, maxLength: 100 } },
    { name: 'page', title: 'Page', type: 'ref', target: 'page', display: 'title', nullable: true },
    { name: 'url', title: 'External URL', type: 'text', nullable: true },
    { name: 'order', title: 'Order', type: 'integer', default: 0 },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Menu',
      columns: [
        { property: 'group', label: 'Menu', width: 12 },
        { property: 'label', label: 'Label', width: 30 },
        { property: 'order', label: 'Order', width: 8 },
      ],
      search: { fields: ['label'] },
      filters: [{ property: 'group' }],
      actions: standardActions,
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Menu Item',
      fields: [
        { property: 'group' },
        { property: 'label', placeholder: 'e.g. About' },
        { property: 'page' },
        { property: 'url', placeholder: 'https://example.com (external link)' },
        { property: 'order' },
      ],
    },
  ],
};

const settingsObject = {
  name: 'settings',
  title: 'Site Settings',
  titlePlural: 'Site Settings',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'singleton', type: 'text', default: 'site', editable: 'never', validation: { unique: true } },
    { name: 'siteTitle', title: 'Site title', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'tagline', title: 'Tagline', type: 'text', nullable: true },
    { name: 'description', title: 'Description', type: 'text', nullable: true, validation: { maxLength: 500 } },
    { name: 'baseUrl', title: 'Base URL', type: 'text', validation: { required: true } },
    { name: 'defaultOgImage', title: 'Default OG image', type: 'image', nullable: true },
    { name: 'twitter', title: 'Twitter/X', type: 'text', nullable: true },
    { name: 'github', title: 'GitHub', type: 'text', nullable: true },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Site Settings',
      columns: [
        { property: 'siteTitle', label: 'Site title', width: 30 },
        { property: 'baseUrl', label: 'Base URL', width: 34 },
      ],
      actions: [
        { hotkey: 'n', label: 'new', kind: 'create', view: 'default' },
        { hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' },
        { hotkey: 'v', label: 'view', kind: 'view', view: 'default' },
      ],
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Site Settings',
      fields: [
        { property: 'siteTitle', placeholder: 'e.g. My Site' },
        { property: 'tagline' },
        { property: 'description', rows: 3 },
        { property: 'baseUrl', placeholder: 'https://example.com' },
        { property: 'defaultOgImage' },
        {
          kind: 'fieldset',
          title: 'Social',
          fields: [{ property: 'twitter' }, { property: 'github' }],
        },
      ],
    },
  ],
};

export const cmsObjects: CmsObject[] = [
  pageObject,
  postObject,
  categoryObject,
  tagObject,
  navItemObject,
  settingsObject,
];

function environments(backend: 'sqlite' | 'postgres'): Record<string, unknown> {
  const envs: Record<string, unknown> = {
    dev: {
      backend: { kind: 'sqlite', path: '.sprintster/dev.db' },
      server: { host: '127.0.0.1', port: 3939 },
      blobs: { dir: '.sprintster/binary-data' },
    },
  };
  if (backend === 'postgres') {
    envs['prod'] = {
      backend: { kind: 'postgres', url: 'postgres://localhost:5432/CHANGEME' },
      server: { host: '127.0.0.1', port: 3030 },
      blobs: { dir: '.sprintster/binary-data' },
    };
  }
  return envs;
}

function projectPackageJson(opts: ScaffoldOptions): unknown {
  return {
    name: opts.name,
    version: '0.0.0',
    private: true,
    type: 'module',
    engines: { node: '>=22', pnpm: '>=11' },
    packageManager: 'pnpm@11.9.0',
    scripts: { dev: 's8r dev', daemon: 's8r daemon', start: 's8r', build: 'scms build', reset: 'scms reset' },
    dependencies: { sprintster: 'latest', 'sprintster-cms': 'latest' },
  };
}

function pnpmWorkspace(opts: ScaffoldOptions): string {
  const lines: string[] = [];
  if (opts.overrides !== undefined) {
    lines.push('overrides:');
    lines.push(`  sprintster: '${opts.overrides.sprintster}'`);
    lines.push(`  sprintster-cms: '${opts.overrides['sprintster-cms']}'`);
  }
  lines.push('allowBuilds:');
  lines.push('  better-sqlite3: true');
  lines.push('  esbuild: true');
  return `${lines.join('\n')}\n`;
}

function readme(name: string): string {
  return [
    `# ${name}`,
    '',
    'A sprintster-cms site.',
    '',
    '## Run',
    '',
    '```',
    's8r dev       # daemon + terminal UI + opens the web GUI in your browser',
    's8r daemon    # daemon only (serves the API and the web GUI)',
    'scms build    # generate the static site (coming soon)',
    'scms reset    # wipe local data and blobs for a clean start',
    '```',
    '',
    'Edit `sprintster.config.json` to change objects, fields, and environments.',
    '',
    'Content objects: pages, posts, categories, tags, a navigation menu, and a',
    'single site-settings record.',
    '',
  ].join('\n');
}

export function buildFiles(opts: ScaffoldOptions): Record<string, string> {
  const config = {
    configVersion: '1',
    environments: environments(opts.backend),
    app: { version: '1', objects: cmsObjects },
  };
  return {
    'sprintster.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'package.json': `${JSON.stringify(projectPackageJson(opts), null, 2)}\n`,
    'pnpm-workspace.yaml': pnpmWorkspace(opts),
    '.gitignore': ['.sprintster/', 'node_modules/', ''].join('\n'),
    'README.md': readme(opts.name),
  };
}
