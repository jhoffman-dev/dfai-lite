import { resolveImageSource } from '../markdown/image-source.ts';
import { decodeImageSource, relativeImageSource } from './image-placement.ts';

const path = (value: string) => value;

describe('relativeImageSource', () => {
  const cases: [note: string, image: string, src: string][] = [
    ['today.md', 'attachments/a.png', 'attachments/a.png'],
    ['Work/today.md', 'attachments/a.png', '../attachments/a.png'],
    ['Work/Plans/q3.md', 'attachments/a.png', '../../attachments/a.png'],
    ['Work/q3.md', 'Work/a.png', 'a.png'],
    ['Work/q3.md', 'Work/img/a.png', 'img/a.png'],
    ['attachments/note.md', 'attachments/a.png', 'a.png'],
    ['Work/q3.md', 'Workshop/a.png', '../Workshop/a.png'],
  ];

  it.each(cases)('from %s to %s is %s', (note, image, src) => {
    expect(relativeImageSource({ notePath: path(note), imagePath: path(image) })).toBe(src);
  });

  it('percent-encodes spaces, brackets and parentheses so the link needs no escaping', () => {
    expect(
      relativeImageSource({
        notePath: path('My notes/today.md'),
        imagePath: path('attachments/Pasted image (1) [x] #2.png'),
      }),
    ).toBe('../attachments/Pasted%20image%20%281%29%20%5Bx%5D%20%232.png');
  });

  it.each([
    ['today.md', 'attachments/Pasted image 20260925143012.png'],
    ['Deep/er/note.md', 'attachments/a b (c) #d %e.png'],
    ['Deep/er/note.md', 'Deep/er/é ü.png'],
  ])('resolves back to the same file from %s', (note, image) => {
    const src = relativeImageSource({ notePath: path(note), imagePath: path(image) });
    expect(resolveImageSource({ src, notePath: path(note) })).toEqual({
      kind: 'vault',
      path: image,
    });
  });
});

describe('decodeImageSource', () => {
  it('decodes percent escapes', () => {
    expect(decodeImageSource('a%20b.png')).toBe('a b.png');
  });

  it('keeps a lone % that is not an escape', () => {
    expect(decodeImageSource('100% done.png')).toBe('100% done.png');
  });
});
