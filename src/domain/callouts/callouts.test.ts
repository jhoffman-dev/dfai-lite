import {
  CALLOUTS_PATH,
  checkCalloutDraft,
  isCalloutsConflictCopy,
  kindAfterChange,
  mergeCalloutSettings,
  offeredCallouts,
  parseCalloutSettings,
  resolveCallout,
  serializeCalloutSettings,
  usesCalloutType,
  withBuiltInHidden,
  withCalloutType,
  withoutCalloutType,
  type CalloutSettings,
  type CalloutType,
} from './index.ts';

const decision: CalloutType = {
  name: 'decision',
  label: 'Decision made',
  hue: 'purple',
  icon: 'flag',
};
const risk: CalloutType = { name: 'Risk', label: null, hue: 'red', icon: 'alert' };
const settings: CalloutSettings = { types: [risk, decision], hidden: [] };

describe('resolveCallout', () => {
  it('finds a built-in by name or alias, ignoring case', () => {
    expect(resolveCallout('WARNING', settings)).toMatchObject({
      key: 'warning',
      label: 'Warning',
      hue: 'orange',
      source: 'built-in',
    });
    expect(resolveCallout('Caution', settings).key).toBe('warning');
  });

  it('finds a custom type ignoring case, its label or its capitalized name as the label', () => {
    expect(resolveCallout('DECISION', settings)).toEqual({
      key: 'decision',
      label: 'Decision made',
      hue: 'purple',
      icon: 'flag',
      source: 'custom',
    });
    expect(resolveCallout('risk', settings).label).toBe('Risk');
  });

  it('draws an unknown type with the fallback, its kind as the label', () => {
    expect(resolveCallout('MyThing', settings)).toEqual({
      key: 'mything',
      label: 'Mything',
      hue: 'gray',
      icon: 'info',
      source: 'unknown',
    });
  });

  it('never lets a custom type restyle a built-in', () => {
    const sneaky: CalloutSettings = { types: [{ ...decision, name: 'note' }], hidden: [] };
    expect(resolveCallout('note', sneaky).source).toBe('built-in');
  });
});

describe('offeredCallouts', () => {
  it('offers the built-ins in order, then the custom types by name', () => {
    const names = offeredCallouts(settings).map((type) => type.name);
    expect(names.slice(0, 3)).toEqual(['note', 'abstract', 'info']);
    expect(names.slice(-2)).toEqual(['decision', 'Risk']);
  });

  it('leaves out a hidden built-in', () => {
    const hidden = withBuiltInHidden(settings, { name: 'Bug', hidden: true });
    expect(offeredCallouts(hidden).map((type) => type.name)).not.toContain('bug');
    const shown = withBuiltInHidden(hidden, { name: 'bug', hidden: false });
    expect(offeredCallouts(shown).map((type) => type.name)).toContain('bug');
  });
});

describe('kindAfterChange', () => {
  it('keeps the note’s spelling when the type is the same, and writes the new name otherwise', () => {
    const note = offeredCallouts(settings)[0]!;
    expect(kindAfterChange('NOTE', note, settings)).toBe('NOTE');
    expect(kindAfterChange('NOTE', decision, settings)).toBe('decision');
    expect(kindAfterChange('caution', offeredCallouts(settings)[7]!, settings)).toBe('caution');
  });
});

describe('the callouts file', () => {
  it('serializes deterministically: sorted, one key order, a newline at the end', () => {
    const text = serializeCalloutSettings({ types: [risk, decision], hidden: ['quote', 'bug'] });
    expect(text).toBe(
      '{\n  "hidden": [\n    "bug",\n    "quote"\n  ],\n  "types": [\n' +
        '    {\n      "name": "decision",\n      "label": "Decision made",\n      "color": "purple",\n      "icon": "flag"\n    },\n' +
        '    {\n      "name": "Risk",\n      "color": "red",\n      "icon": "alert"\n    }\n  ]\n}\n',
    );
    expect(serializeCalloutSettings({ types: [decision, risk], hidden: ['bug', 'quote'] })).toBe(
      text,
    );
  });

  it('reads back what it writes', () => {
    const text = serializeCalloutSettings(settings);
    const parsed = parseCalloutSettings(text);
    expect(parsed.kind).toBe('ok');
    expect(serializeCalloutSettings(parsed.settings)).toBe(text);
  });

  it.each([
    ['not JSON', '{ nope', 'is not valid JSON'],
    ['a list', '[]', 'is not an object'],
    ['types not a list', '{"types": {}}', '"types" that is not a list'],
    ['a type without a name', '{"types": [{"color": "red"}]}', 'without a usable name'],
    ['a name with a space', '{"types": [{"name": "my type"}]}', 'without a usable name'],
  ])('reads %s as malformed, with no types, and says why', (_label, text, reason) => {
    const parsed = parseCalloutSettings(text);
    expect(parsed.kind).toBe('malformed');
    expect(parsed.settings.types).toEqual([]);
    if (parsed.kind === 'malformed') {
      expect(parsed.reason).toContain(CALLOUTS_PATH);
      expect(parsed.reason).toContain(reason);
    }
  });

  it('draws a color or icon it does not know with the fallback’s, and keeps a type once', () => {
    const parsed = parseCalloutSettings(
      '{"types": [{"name": "odd", "color": "teal", "icon": "rocket"}, {"name": "ODD"}]}',
    );
    expect(parsed.settings.types).toEqual([
      { name: 'odd', label: null, hue: 'gray', icon: 'info' },
    ]);
  });

  it('keeps only built-in names in the hidden list, lowercased', () => {
    const parsed = parseCalloutSettings('{"hidden": ["Bug", "decision", 3]}');
    expect(parsed.settings.hidden).toEqual(['bug']);
  });

  it('knows the other Mac’s copy of the file', () => {
    expect(isCalloutsConflictCopy('.dfai-lite/callouts (conflict from Work Mac).json')).toBe(true);
    expect(isCalloutsConflictCopy('.dfai-lite/callouts (conflict from Work Mac) 2.json')).toBe(
      true,
    );
    expect(isCalloutsConflictCopy(CALLOUTS_PATH)).toBe(false);
    expect(isCalloutsConflictCopy('Notes/callouts (conflict from Work Mac).json')).toBe(false);
  });

  it('merges both Macs’ types, this Mac’s standing where both have one', () => {
    const theirs: CalloutSettings = {
      types: [
        { ...risk, hue: 'blue' },
        { name: 'idea', label: null, hue: 'yellow', icon: 'lightbulb' },
      ],
      hidden: ['bug'],
    };
    const merged = mergeCalloutSettings(settings, [theirs]);
    expect(merged.types.map((type) => type.name)).toEqual(['decision', 'idea', 'Risk']);
    expect(merged.types.find((type) => type.name === 'Risk')?.hue).toBe('red');
    expect(merged.hidden).toEqual([]);
  });
});

describe('checkCalloutDraft', () => {
  const draft = { name: 'meeting', label: '', hue: 'green', icon: 'calendar' };
  const check = (changes: Partial<typeof draft>, replacing: string | null = null) =>
    checkCalloutDraft({ ...draft, ...changes }, { settings, replacing });

  it('accepts a good draft, trimming it and keeping no empty label', () => {
    expect(check({ name: ' meeting ' })).toEqual({
      kind: 'ok',
      type: { name: 'meeting', label: null, hue: 'green', icon: 'calendar' },
    });
  });

  it.each([
    ['', 'Give the type a name.'],
    ['my type', 'no spaces'],
    ['a]b', 'no spaces or ]'],
    ['1st', 'Start with a letter'],
    ['caution', 'is a built-in type'],
    ['Note', 'is a built-in type'],
    ['DECISION', 'already a type named'],
  ])('refuses the name %j', (name, problem) => {
    const result = check({ name });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.problems.name).toContain(problem);
  });

  it('lets an edited type keep its own name, in another case', () => {
    expect(check({ name: 'Decision' }, 'decision').kind).toBe('ok');
  });

  it('allows digits, - and _ after the first letter', () => {
    expect(check({ name: 'q3-review_notes' }).kind).toBe('ok');
  });

  it('refuses a color or icon outside the sets, and a long label', () => {
    const result = check({ hue: 'teal', icon: 'rocket', label: 'x'.repeat(41) });
    expect(result).toEqual({
      kind: 'invalid',
      problems: {
        label: 'Keep the label to 40 characters.',
        hue: 'Pick a color.',
        icon: 'Pick an icon.',
      },
    });
  });
});

describe('editing the settings', () => {
  it('adds a type, replaces one by its old name, and deletes one ignoring case', () => {
    const meeting: CalloutType = { name: 'meeting', label: null, hue: 'green', icon: 'calendar' };
    const added = withCalloutType(settings, { type: meeting, replacing: null });
    expect(added.types).toHaveLength(3);
    const renamed = withCalloutType(added, {
      type: { ...meeting, name: 'sync' },
      replacing: 'meeting',
    });
    expect(renamed.types.map((type) => type.name).sort()).toEqual(['Risk', 'decision', 'sync']);
    expect(withoutCalloutType(renamed, 'RISK').types.map((type) => type.name)).not.toContain(
      'Risk',
    );
  });
});

describe('usesCalloutType', () => {
  it('finds a callout of the type at any quote depth, ignoring case', () => {
    expect(usesCalloutType('Intro\n\n> [!Decision] Go\n> body\n', 'decision')).toBe(true);
    expect(usesCalloutType('> > [!decision]\n', 'decision')).toBe(true);
    expect(usesCalloutType('[!decision] not in a quote\n', 'decision')).toBe(false);
    expect(usesCalloutType('> [!decisions]\n', 'decision')).toBe(false);
  });
});
