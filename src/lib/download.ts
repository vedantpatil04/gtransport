/**
 * Saves a generated file. Inside the hosted Claude artifact viewer, downloads go through
 * the viewer's `downloads` capability; everywhere else a normal browser download is used.
 */
interface DownloadsNamespace {
  save: (req: { filename: string; data: Blob }) => Promise<{ status: string }>;
}
type ClaudeHost = { use?: (name: string) => Promise<unknown> };

let hostDownloads: Promise<DownloadsNamespace | null> | null = null;

function getHostDownloads() {
  if (!hostDownloads) {
    const host = (window as unknown as { claude?: ClaudeHost }).claude;
    hostDownloads = host?.use
      ? Promise.race([
          host.use('downloads').then((ns) => (ns as DownloadsNamespace | null) ?? null).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 5000)),
        ])
      : Promise.resolve(null);
  }
  return hostDownloads;
}

export type SaveResult = 'saved' | 'declined' | 'failed';

export async function saveFile(filename: string, blob: Blob): Promise<SaveResult> {
  const ns = await getHostDownloads();
  if (ns) {
    try {
      await ns.save({ filename, data: blob });
      return 'saved';
    } catch (err) {
      return (err as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
