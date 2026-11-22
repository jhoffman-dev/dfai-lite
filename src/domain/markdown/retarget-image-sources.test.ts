import { retargetImageSources } from './retarget-image-sources.ts';

/*
 * A relative image source is read from the note's folder, so a move of the note
 * or of the folder holding the image can leave it pointing at nothing. "Update
 * links" re-points it, counts it, and changes nothing else.
 */

/** `text`, in the note now at `path`, after `from` moved to `to` in a vault holding `files`. */
function afterMove({
  text,
  path,
  from,
  to,
  files,
}: {
  text: string;
  path: string;
  from: string;
  to: string;
  files: string[];
}) {
  return retargetImageSources({
    text,
    path,
    exists: (file) => files.includes(file),
    move: { from, to },
  });
}

describe('retargetImageSources', () => {
  it('re-points an image in a note that did not move, into a folder that did', () => {
    expect(
      afterMove({
        text: 'Look: ![](Work/pic.png)\n',
        path: 'Home.md',
        from: 'Work',
        to: 'Archive/Work',
        files: ['Archive/Work/pic.png'],
      }),
    ).toEqual({ text: 'Look: ![](Archive/Work/pic.png)\n', count: 1 });
  });

  it('leaves an image that moved along with its note, in the same folder', () => {
    const text = '![](pic.png)\n';
    expect(
      afterMove({
        text,
        path: 'Archive/Work/a.md',
        from: 'Work',
        to: 'Archive/Work',
        files: ['Archive/Work/pic.png'],
      }),
    ).toEqual({ text, count: 0 });
  });

  it('leaves a note the move did not touch, even one found from the vault root', () => {
    const text = '![](attachments/pic.png)\n';
    expect(
      afterMove({
        text,
        path: 'Notes/b.md',
        from: 'Plan.md',
        to: 'Roadmap.md',
        files: ['attachments/pic.png'],
      }),
    ).toEqual({ text, count: 0 });
  });

  it('changes only the destination, keeping the alt text, the title and the rest', () => {
    expect(
      afterMove({
        text: 'A ![Chart *one*](../attachments/c.png "Q3") and [[Other]].\n',
        path: 'Work/Plans/q3.md',
        from: 'Work/q3.md',
        to: 'Work/Plans/q3.md',
        files: ['attachments/c.png'],
      }),
    ).toEqual({
      text: 'A ![Chart *one*](../../attachments/c.png "Q3") and [[Other]].\n',
      count: 1,
    });
  });

  it('writes a destination in angle brackets back percent-encoded', () => {
    expect(
      afterMove({
        text: '![](<../attachments/my pic.png>)\n',
        path: 'q3.md',
        from: 'Work/q3.md',
        to: 'q3.md',
        files: ['attachments/my pic.png'],
      }).text,
    ).toBe('![](attachments/my%20pic.png)\n');
  });

  it('leaves an image in code, one outside the vault, and one that is not there', () => {
    const text = [
      '`![](../a.png)`',
      '![](https://example.com/a.png)',
      '![](../missing.png)',
      '',
    ].join('\n');
    expect(
      afterMove({
        text,
        path: 'q3.md',
        from: 'Work/q3.md',
        to: 'q3.md',
        files: ['a.png'],
      }),
    ).toEqual({ text, count: 0 });
  });
});

/*
 * The rule: a move changes an image source only when, left as it is, it would
 * stop resolving to the file it resolved to before; then it is written in the
 * style it was written in.
 */
describe('retargetImageSources, leaving what still resolves', () => {
  const renamed = (text: string) =>
    afterMove({
      text,
      path: 'Projects/new.md',
      from: 'Projects/old.md',
      to: 'Projects/new.md',
      files: ['attachments/x.png'],
    });

  it.each([
    ['vault-absolute, Obsidian’s style', '![a](attachments/x.png)\n'],
    ['with a leading slash', '![a](/attachments/x.png)\n'],
    ['relative', '![a](../attachments/x.png)\n'],
  ])('leaves a %s source alone when its note is renamed in place', (_label, text) => {
    expect(renamed(text)).toEqual({ text, count: 0 });
  });

  it('keeps a vault-absolute source vault-absolute when the folder it names moves', () => {
    expect(
      afterMove({
        text: '![a](attachments/x.png) ![b](/attachments/x.png)\n',
        path: 'Projects/n.md',
        from: 'attachments',
        to: 'Media/attachments',
        files: ['Media/attachments/x.png'],
      }),
    ).toEqual({
      text: '![a](Media/attachments/x.png) ![b](/Media/attachments/x.png)\n',
      count: 2,
    });
  });

  it('keeps a relative source relative when the note moves deeper', () => {
    expect(
      afterMove({
        text: '![a](../attachments/x.png)\n',
        path: 'Projects/2026/n.md',
        from: 'Projects/n.md',
        to: 'Projects/2026/n.md',
        files: ['attachments/x.png'],
      }).text,
    ).toBe('![a](../../attachments/x.png)\n');
  });

  it('never touches a source in an indented code block, a fence or a span', () => {
    const text = 'Code:\n\n    ![a](x.png)\n\n```\n![b](x.png)\n```\n\n`![c](x.png)`\n';
    expect(
      afterMove({ text, path: 'b/n.md', from: 'a/n.md', to: 'b/n.md', files: ['a/x.png'] }),
    ).toEqual({ text, count: 0 });
  });

  it('follows an image in a list item’s indented paragraph, which is not code', () => {
    expect(
      afterMove({
        text: '- item\n\n    ![a](x.png)\n',
        path: 'b/n.md',
        from: 'a/n.md',
        to: 'b/n.md',
        files: ['a/x.png'],
      }).text,
    ).toBe('- item\n\n    ![a](../a/x.png)\n');
  });

  it('follows the reference definition an image uses, under the same rule', () => {
    const text = '![a][chart] and [b]: q.png\n\n[chart]: <x y.png> "Q3"\n[b]: x%20y.png\n';
    expect(
      afterMove({ text, path: 'b/n.md', from: 'a/n.md', to: 'b/n.md', files: ['a/x y.png'] }),
    ).toEqual({
      text: '![a][chart] and [b]: q.png\n\n[chart]: ../a/x%20y.png "Q3"\n[b]: x%20y.png\n',
      count: 1,
    });
  });

  it('leaves an HTML image alone', () => {
    const text = '<img src="x.png">\n';
    expect(
      afterMove({ text, path: 'b/n.md', from: 'a/n.md', to: 'b/n.md', files: ['a/x.png'] }),
    ).toEqual({ text, count: 0 });
  });
});
