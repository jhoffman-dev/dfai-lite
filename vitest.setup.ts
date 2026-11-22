import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The editor and the markdown reader load as lazy chunks. A slow CI machine
// takes more than the default second to mount a second editor, so a wait for
// one gives the condition longer. A wait still ends the moment it holds.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
