/**
 * Open a link outside the app.
 *
 * The desktop shell hands it to the system browser, which keeps the app window
 * from being navigated away to a sign-in page. In a plain browser build there
 * is no shell, so a new tab is the best available.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) return;
  const desktop = window.desktop;
  if (desktop?.openExternal) {
    try {
      await desktop.openExternal(url);
      return;
    } catch {
      /* fall through to the browser */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
