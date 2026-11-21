import { FileChangedError, FileExistsError, TrashRefusedError } from '../../application/index.ts';
import { hostError } from './index.ts';

describe('the host’s errors', () => {
  it('become the port’s errors by their prefix, and plain errors otherwise', () => {
    expect(hostError('changed: Inbox/a.md changed since it was read')).toBeInstanceOf(
      FileChangedError,
    );
    expect(hostError('exists: a file is already at Inbox/a.md')).toBeInstanceOf(FileExistsError);
    expect(hostError('trash: the Trash would not take Inbox/a.md')).toBeInstanceOf(
      TrashRefusedError,
    );
    const other = hostError('cannot read Inbox/a.md: denied');
    expect(other).not.toBeInstanceOf(FileChangedError);
    expect(other.message).toBe('cannot read Inbox/a.md: denied');
  });
});
