/**
 * DOM construction helpers.
 *
 * The whole UI is built through these functions and never through `innerHTML`
 * (an ESLint rule enforces that). Text always lands in text nodes, so registry
 * data — which is third-party content — cannot become markup, and the strict
 * CSP never needs `'unsafe-inline'`.
 */

export type Child = Node | string | number | null | undefined | false;

type EventMap = HTMLElementEventMap;

export interface ElementOptions {
  readonly className?: string;
  /** Text content, inserted as a text node. */
  readonly text?: string | number;
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly on?: {
    readonly [K in keyof EventMap]?: (event: EventMap[K]) => void;
  };
}

/** Attributes that can execute script or navigate; handled explicitly, never generically. */
const UNSAFE_ATTRS = new Set(['href', 'src', 'srcdoc', 'action', 'formaction', 'xlink:href']);

/**
 * Accepts a URL only if it is `https:`.
 *
 * Second line of defence after `normalizeRegistryUrl`: anything that reaches an
 * `href` passes through here, so a `javascript:` or `data:` URL sneaking in
 * from remote JSON cannot become a clickable link.
 */
export function safeHttpsUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Sets `href` on an anchor, or removes it when the URL is not safe. */
export function setSafeHref(anchor: HTMLAnchorElement, raw: string | undefined | null): void {
  const safe = safeHttpsUrl(raw);
  if (safe === null) {
    anchor.removeAttribute('href');
    return;
  }
  anchor.href = safe;
  anchor.target = '_blank';
  // `noopener` blocks reverse tabnabbing; `noreferrer` keeps our URL out of the
  // registry's referrer logs.
  anchor.rel = 'noopener noreferrer';
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.toLowerCase().startsWith('on') || UNSAFE_ATTRS.has(name.toLowerCase())) {
      throw new Error(`Refusing to set attribute "${name}" generically; use a dedicated helper.`);
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }

  for (const [key, value] of Object.entries(options.dataset ?? {})) {
    node.dataset[key] = value;
  }

  for (const [type, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(type, handler as EventListener);
  }

  append(node, children);
  return node;
}

/** Appends children, skipping the falsy ones so `cond && el(…)` reads naturally. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Replaces all children in one operation. */
export function render(parent: Element, children: readonly Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

/**
 * `getElementById` that fails loudly when markup and code drift apart.
 *
 * The expected element type is passed in and verified with `instanceof` rather
 * than asserted with a type parameter: the check then catches an id that moved
 * to a different kind of element, which a bare cast would happily wave through
 * until it crashed somewhere unrelated.
 */
export function requireElement<T extends HTMLElement>(
  id: string,
  type: abstract new (...args: never[]) => T,
): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing required element #${id}`);
  if (!(node instanceof type)) {
    throw new Error(`Element #${id} is a ${node.tagName}, expected ${type.name}`);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an inline icon from a fixed set of path data (never user input). */
export function icon(
  pathData: string,
  options: { size?: number; label?: string } = {},
): SVGElement {
  const size = options.size ?? 16;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', options.label === undefined ? 'true' : 'false');
  if (options.label !== undefined) svg.setAttribute('aria-label', options.label);

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

/** Feather-style icon paths used across the UI. */
export const IconPaths = {
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm10 18-4.35-4.35',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  chevron: 'm6 9 6 6 6-6',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  stop: 'M6 6h12v12H6z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6',
  check: 'M20 6 9 17l-5-5',
} as const;
