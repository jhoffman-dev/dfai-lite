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
