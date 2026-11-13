/** Only a path on this site: anything a browser would read as another site becomes the overview. */
export function samePath(back: string): string {
  const base = 'http://panel.invalid';
  try {
    const url = new URL(back, base);
    return url.origin === base ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
