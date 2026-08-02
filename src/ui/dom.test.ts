// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { append, el, render, requireElement, safeHttpsUrl, setSafeHref } from './dom.js';

describe('safeHttpsUrl', () => {
  it('accepts an https URL', () => {
    expect(safeHttpsUrl('https://rdap.example.com/domain/acme.com')).toBe(
      'https://rdap.example.com/domain/acme.com',
    );
  });

  it.each([
    'http://rdap.example.com/',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'not a url',
    '',
    null,
    undefined,
  ])('rejects %s', (input) => {
    expect(safeHttpsUrl(input)).toBeNull();
  });
});

describe('setSafeHref', () => {
  it('sets the link plus the protective rel attributes', () => {
    const anchor = document.createElement('a');
    setSafeHref(anchor, 'https://rdap.example.com/x');

    expect(anchor.getAttribute('href')).toBe('https://rdap.example.com/x');
    expect(anchor.rel).toContain('noopener');
    expect(anchor.rel).toContain('noreferrer');
    expect(anchor.target).toBe('_blank');
  });

  it('leaves no href at all for an unsafe URL', () => {
    const anchor = document.createElement('a');
    setSafeHref(anchor, 'javascript:alert(1)');
    expect(anchor.hasAttribute('href')).toBe(false);
  });
});

describe('el', () => {
  it('puts text into a text node, never into markup', () => {
    const node = el('span', { text: '<img src=x onerror=alert(1)>' });
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(node.querySelector('img')).toBeNull();
  });

  it('applies class, attributes and dataset', () => {
    const node = el('div', {
      className: 'card',
      attrs: { role: 'group', hidden: true, tabindex: -1 },
      dataset: { status: 'available' },
    });

    expect(node.className).toBe('card');
    expect(node.getAttribute('role')).toBe('group');
    expect(node.hasAttribute('hidden')).toBe(true);
    expect(node.dataset['status']).toBe('available');
  });

  it('skips null, undefined and false attributes', () => {
    const node = el('div', { attrs: { title: undefined, 'aria-hidden': false } });
    expect(node.hasAttribute('title')).toBe(false);
    expect(node.hasAttribute('aria-hidden')).toBe(false);
  });

  it.each(['href', 'src', 'onclick', 'formaction'])(
    'refuses to set %s generically',
    (attribute) => {
      expect(() => el('a', { attrs: { [attribute]: 'javascript:alert(1)' } })).toThrow(
        /Refusing to set attribute/,
      );
    },
  );

  it('wires event listeners', () => {
    const onClick = vi.fn();
    const button = el('button', { on: { click: onClick } });
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('appends children and skips falsy ones', () => {
    const node = el('div', {}, [el('span', { text: 'a' }), null, false, undefined, 'b', 3]);
    expect(node.textContent).toBe('ab3');
  });
});

describe('append and render', () => {
  it('render replaces existing children', () => {
    const host = el('div', {}, ['old']);
    render(host, ['new']);
    expect(host.textContent).toBe('new');
  });

  it('append adds to existing children', () => {
    const host = el('div', {}, ['a']);
    append(host, ['b']);
    expect(host.textContent).toBe('ab');
  });
});

describe('requireElement', () => {
  it('returns the element when present and of the expected type', () => {
    const node = el('button', { attrs: { id: 'present' } });
    document.body.appendChild(node);
    expect(requireElement('present', HTMLButtonElement)).toBe(node);
  });

  it('throws loudly when the element is missing', () => {
    expect(() => requireElement('does-not-exist', HTMLElement)).toThrow(/Missing required element/);
  });

  it('throws when the id moved to a different kind of element', () => {
    document.body.appendChild(el('div', { attrs: { id: 'wrong-type' } }));
    expect(() => requireElement('wrong-type', HTMLButtonElement)).toThrow(/expected/);
  });
});
