import { plainMarkdown } from '../application/testing/index.ts';
import { createMarkdownLoader } from './markdown-loader.ts';

describe('loading the markdown port', () => {
  it('fetches once and hands back the same promise', async () => {
    let fetches = 0;
    const load = createMarkdownLoader(async () => {
      fetches += 1;
      return plainMarkdown;
    });
    expect(load()).toBe(load());
    await expect(load({ afresh: true })).resolves.toBe(plainMarkdown);
    expect(fetches).toBe(1);
  });

  it('keeps a failed fetch until asked afresh, then fetches again', async () => {
    let fetches = 0;
    const load = createMarkdownLoader(async () => {
      fetches += 1;
      if (fetches === 1) throw new Error('chunk failed to load');
      return plainMarkdown;
    });
    await expect(load()).rejects.toThrow('chunk failed to load');
    await expect(load()).rejects.toThrow('chunk failed to load');
    expect(fetches).toBe(1);
    await expect(load({ afresh: true })).resolves.toBe(plainMarkdown);
    expect(fetches).toBe(2);
  });
});
