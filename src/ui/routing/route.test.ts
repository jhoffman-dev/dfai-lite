import { formatRoute, parseRoute, type Route } from './route.ts';

describe('the mind map route', () => {
  const cases: [string, Route][] = [
    ['#/map', { kind: 'map', root: null }],
    [
      '#/map/note/Projects%2FLarkspur%20Payroll.md',
      {
        kind: 'map',
        root: { kind: 'note', path: 'Projects/Larkspur Payroll.md' },
      },
    ],
    ['#/map/tag/area%2Fwork', { kind: 'map', root: { kind: 'tag', key: 'area/work' } }],
  ];

  it.each(cases)('reads %s and writes it back the same', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(formatRoute(route)).toBe(hash);
  });

  it('follows the open note for a root it cannot read', () => {
    expect(parseRoute('#/map/folder/x')).toEqual({ kind: 'map', root: null });
    expect(parseRoute('#/map/note/%E0')).toEqual({ kind: 'map', root: null });
    expect(parseRoute('#/map/note/')).toEqual({ kind: 'map', root: null });
  });
});
