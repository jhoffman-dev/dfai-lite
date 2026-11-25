import { mapRootOf } from './map-root-of.ts';
import { shortcutFor } from './shortcuts.ts';

describe('what a mind map opens from', () => {
  it('maps the open note, the chosen tag, or follows', () => {
    expect(mapRootOf({ kind: 'note', path: 'A.md' })).toEqual({ kind: 'note', path: 'A.md' });
    expect(mapRootOf({ kind: 'tags', tag: 'idea' })).toEqual({ kind: 'tag', key: 'idea' });
    expect(mapRootOf({ kind: 'tags', tag: null })).toBeNull();
    expect(mapRootOf({ kind: 'graph' })).toBeNull();
    expect(mapRootOf({ kind: 'home' })).toBeNull();
  });

  it('opens with ⌘⇧G', () => {
    const press = {
      code: 'KeyG',
      key: 'g',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(shortcutFor(press, 'desktop')?.command).toBe('map.open');
  });
});
