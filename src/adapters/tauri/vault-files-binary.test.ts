import { FileExistsError } from '../../application/index.ts';

/*
 * The Tauri adapter's half of the binary port, against a stand-in for the
 * host's `invoke`: how a picture's bytes go out and come back, and how the
 * host's refusals (`src-tauri/src/binary.rs`) reach the caller.
 */

const calls: { command: string; args: unknown; options: unknown }[] = [];
let answer: (command: string, args: unknown) => unknown = () => undefined;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: unknown, options: unknown) => {
    calls.push({ command, args, options });
    return answer(command, args);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => undefined }));

const { openTauriVaultFiles } = await import('./vault-files.ts');

beforeEach(() => {
  calls.length = 0;
  answer = () => undefined;
});

describe('pictures through the Rust host', () => {
  it('come back as the bytes the host sent raw', async () => {
    answer = (command) =>
      command === 'read_binary_file' ? new Uint8Array([1, 2, 3]).buffer : null;
    const files = await openTauriVaultFiles('/vault');
    expect(await files.readBinary('attachments/a.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.at(-1)).toMatchObject({
      command: 'read_binary_file',
      args: { path: 'attachments/a.png' },
    });
  });

  it('read as null when the host says the file is missing', async () => {
    answer = (command) => {
      if (command === 'read_binary_file') throw 'missing: there is no file at a.png';
      return null;
    };
    const files = await openTauriVaultFiles('/vault');
    expect(await files.readBinary('a.png')).toBeNull();
  });

  it('are looked for with the host’s stat, not read', async () => {
    answer = (command) => command === 'file_exists';
    const files = await openTauriVaultFiles('/vault');
    expect(await files.exists('attachments/a.png')).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      command: 'file_exists',
      args: { path: 'attachments/a.png' },
    });
  });

  it('reject with the host’s reason for anything else', async () => {
    answer = (command) => {
      if (command === 'read_binary_file') throw 'big.png is over 32 MB';
      return null;
    };
    const files = await openTauriVaultFiles('/vault');
    await expect(files.readBinary('big.png')).rejects.toThrow('big.png is over 32 MB');
  });

  it('go out as the raw body, the path percent-encoded in a header, never over a file', async () => {
    answer = (command) => {
      if (command === 'write_binary_file') throw 'exists: a file is already at attachments/é b.png';
      return null;
    };
    const files = await openTauriVaultFiles('/vault');
    const bytes = new Uint8Array([9, 8]);
    await expect(files.writeBinary({ path: 'attachments/é b.png', bytes })).rejects.toBeInstanceOf(
      FileExistsError,
    );
    expect(calls.at(-1)).toEqual({
      command: 'write_binary_file',
      args: bytes,
      options: { headers: { 'dfai-lite-path': 'attachments%2F%C3%A9%20b.png' } },
    });
  });
});
