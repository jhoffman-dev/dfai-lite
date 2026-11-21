import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/app.tsx';
import { keepPageMenuToText } from '../ui/shell/page-menu.ts';
import { Welcome } from '../ui/welcome/welcome.tsx';
import { boot } from './composition.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root to mount the app in.');

keepPageMenuToText(document);
const started = await boot();

createRoot(root).render(
  <StrictMode>
    {started.kind === 'app' ? (
      <App services={started.services} layoutStorage={started.layoutStorage} />
    ) : (
      <Welcome problem={started.problem} onChoose={started.choose} />
    )}
  </StrictMode>,
);
if (started.kind === 'app') started.start();
