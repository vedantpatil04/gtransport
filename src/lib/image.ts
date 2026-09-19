export interface PreparedFile {
  dataUrl: string;
  name: string;
  size: number;
  kind: 'image' | 'pdf';
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * Receipts are optimised automatically (smaller, faster uploads on weak networks).
 * Official documents keep near-original quality. None of this is shown to the driver.
 */
export async function prepareFile(file: File, purpose: 'receipt' | 'document'): Promise<PreparedFile> {
  if (file.type === 'application/pdf') {
    return { dataUrl: await readAsDataUrl(file), name: file.name, size: file.size, kind: 'pdf' };
  }
  const maxSide = purpose === 'receipt' ? 1400 : 2600;
  const quality = purpose === 'receipt' ? 0.74 : 0.92;
  const original = await readAsDataUrl(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = original;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && purpose === 'document') return { dataUrl: original, name: file.name, size: file.size, kind: 'image' };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, name: file.name, size: Math.round((dataUrl.length * 3) / 4), kind: 'image' };
  } catch {
    return { dataUrl: original, name: file.name, size: file.size, kind: 'image' };
  }
}
