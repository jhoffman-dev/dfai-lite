// The theme chosen last time, on the root before the first paint (as DFAI's
// index.html does it): the app sets it again from this device's settings once
// it runs, but until then the stylesheet would follow the system and a dark
// choice would flash light. A file, not inline, so the window's policy
// (script-src 'self') allows it. The key is src/ui/theme/browser-theme.ts's.
/* global window, document */
(function () {
  try {
    var choice = window.localStorage.getItem('dfai-lite.theme');
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = choice === 'light' || choice === 'dark' ? choice : dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
  } catch {
    /* Safe to ignore: storage may be blocked, as in a private window; the
       stylesheet follows the system until the app sets the theme. */
  }
})();
