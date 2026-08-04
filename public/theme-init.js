// Apply the saved theme before first paint so dark-mode users never flash white
// on load. Default is light, so the absence of a stored "dark" value = light.
// Kept in sync with next-themes (storageKey "theme") configured in src/App.tsx.
//
// This lives in a file rather than inline in index.html so the Content-Security
// -Policy in vercel.json can use script-src 'self' with no 'unsafe-inline' and no
// per-build hash to maintain. It must stay a plain blocking <script src> in
// <head> — adding defer or async would let the page paint before it runs, which
// is the exact flash it exists to prevent.
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
