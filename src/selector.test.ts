// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cssPath } from './selector';

/** Renders markup and returns the single `<img>` inside it. */
function render(html: string): HTMLImageElement {
  document.body.innerHTML = html;
  return document.querySelector('img')!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cssPath', () => {
  it('describes an element by its ancestry, ignoring html and body', () => {
    const img = render('<main><article><img src="a.png"></article></main>');
    expect(cssPath(img)).toBe('main > article > img');
  });

  it('disambiguates siblings that share a tag name', () => {
    document.body.innerHTML = '<ul><li></li><li><img src="a.png"></li></ul>';
    const img = document.querySelector('img')!;
    expect(cssPath(img)).toBe('ul > li:nth-of-type(2) > img');
  });

  it('omits :nth-of-type when the tag name is already unique among siblings', () => {
    const img = render('<div><span></span><img src="a.png"></div>');
    expect(cssPath(img)).toBe('div > img');
  });

  it('anchors at the nearest id and stops climbing', () => {
    const img = render('<main><div id="gallery"><figure><img src="a.png"></figure></div></main>');
    expect(cssPath(img)).toBe('#gallery > figure > img');
  });

  it('anchors at a test id when no id is present, and stops climbing', () => {
    const img = render('<main><div data-testid="hero"><img src="a.png"></div></main>');
    expect(cssPath(img)).toBe('div[data-testid="hero"] > img');
  });

  it('escapes an id that is not a bare CSS identifier', () => {
    const img = render('<div id="a.b:c"><img src="a.png"></div>');
    expect(cssPath(img)).toBe('#a\\.b\\:c > img');
  });

  it('escapes a quote embedded in a test id', () => {
    const img = render('<div data-testid=\'say "hi"\'><img src="a.png"></div>');
    expect(cssPath(img)).toBe('div[data-testid="say \\"hi\\""] > img');
  });

  it('stops after six segments rather than emitting an unreadable path', () => {
    const img = render('<div><div><div><div><div><div><div><img src="a.png"></div></div></div></div></div></div></div>');
    expect(cssPath(img)?.split(' > ')).toHaveLength(6);
  });

  it('produces a selector that finds the element again', () => {
    const img = render(
      '<main><section></section><section><figure><img src="a.png"></figure></section></main>',
    );
    expect(document.querySelector(cssPath(img)!)).toBe(img);
  });

  it('returns null for an element with no tag name, and for nothing at all', () => {
    expect(cssPath(null)).toBeNull();
    expect(cssPath(undefined)).toBeNull();
    expect(cssPath({} as Element)).toBeNull();
  });

  it('describes a detached element as far as it can', () => {
    const orphan = document.createElement('img');
    expect(cssPath(orphan)).toBe('img');
  });
});
