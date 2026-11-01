const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

// strftime codes, the subset Liquid themes actually use. Dates are formatted in UTC: the store keeps ISO 8601 UTC and a site has no timezone of its own.
export function date(value: unknown, format = '%Y-%m-%d'): string {
  const d = toDate(value);
  if (d === null) return '';
  return format.replace(/%(.)/g, (_, code: string) => {
    switch (code) {
      case 'Y':
        return String(d.getUTCFullYear());
      case 'y':
        return pad(d.getUTCFullYear() % 100);
      case 'm':
        return pad(d.getUTCMonth() + 1);
      case 'B':
        return MONTHS[d.getUTCMonth()] as string;
      case 'b':
        return (MONTHS[d.getUTCMonth()] as string).slice(0, 3);
      case 'd':
        return pad(d.getUTCDate());
      case 'e':
        return String(d.getUTCDate());
      case 'A':
        return DAYS[d.getUTCDay()] as string;
      case 'a':
        return (DAYS[d.getUTCDay()] as string).slice(0, 3);
      case 'H':
        return pad(d.getUTCHours());
      case 'M':
        return pad(d.getUTCMinutes());
      case 'S':
        return pad(d.getUTCSeconds());
      case 'F':
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      case '%':
        return '%';
      default:
        return `%${code}`;
    }
  });
}

export function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function strip_html(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, '');
}

export function truncate(value: unknown, length = 50, ellipsis = '...'): string {
  const s = String(value ?? '');
  if (s.length <= length) return s;
  return s.slice(0, Math.max(0, length - ellipsis.length)) + ellipsis;
}

export function truncatewords(value: unknown, words = 15, ellipsis = '...'): string {
  const parts = String(value ?? '').split(/\s+/).filter((w) => w !== '');
  if (parts.length <= words) return parts.join(' ');
  return parts.slice(0, words).join(' ') + ellipsis;
}

export function size(value: unknown): number {
  if (Array.isArray(value) || typeof value === 'string') return value.length;
  if (value !== null && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export function join(value: unknown, glue = ' '): string {
  return Array.isArray(value) ? value.map((v) => String(v)).join(glue) : String(value ?? '');
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

export function fallback(value: unknown, other: unknown): unknown {
  return isBlank(value) ? other : value;
}

export function upcase(value: unknown): string {
  return String(value ?? '').toUpperCase();
}

export function downcase(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

export function slugify(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function where(value: unknown, key: string, wanted?: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    const actual = (item as Record<string, unknown>)?.[key];
    return wanted === undefined ? !isBlank(actual) : actual === wanted;
  });
}

// Liquid's sort: by a property when given, items missing it last.
export function sort(value: unknown, key?: string): unknown[] {
  if (!Array.isArray(value)) return [];
  const of = (item: unknown): unknown => (key === undefined ? item : (item as Record<string, unknown>)?.[key]);
  return [...value].sort((a, b) => {
    const [x, y] = [of(a), of(b)];
    if (isBlank(x) || isBlank(y)) return Number(isBlank(x)) - Number(isBlank(y));
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  });
}

// 'default' is a reserved word, so the registry name and the exported binding differ here alone.
export const filters = {
  date,
  escape,
  strip_html,
  truncate,
  truncatewords,
  size,
  join,
  default: fallback,
  upcase,
  downcase,
  slugify,
  where,
  sort,
} as const;

export type Filters = typeof filters;
