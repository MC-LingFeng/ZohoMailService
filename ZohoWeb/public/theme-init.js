// Apply the saved appearance before the application and styles load.
(() => {
  let mode = 'auto';
  try {
    const saved = localStorage.getItem('zohome.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') mode = saved;
  } catch {
    // Theme switching still works when the browser blocks local storage.
  }
  const prefersDark =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#10171c' : '#f7f8fa');
})();
