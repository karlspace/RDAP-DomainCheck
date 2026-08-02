/**
 * Getting data out of the app: downloads and clipboard.
 *
 * Both are best-effort by nature (blocked popups, denied clipboard permission,
 * non-secure contexts), so both report success as a boolean instead of
 * throwing at the call site.
 */

/** Triggers a client-side download without ever touching a server. */
export function downloadText(filename: string, content: string, mimeType: string): boolean {
  try {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Revoking immediately can cancel the download in some browsers; one tick
    // later the navigation has been handed off.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch {
    return false;
  }
}

/** Copies text to the clipboard. Requires a secure context (HTTPS or localhost). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
