/**
 * Turning inbound mail into inert text — shared by every provider adapter.
 *
 * Everything an email contains is untrusted (§24). HTML is flattened to text here, at the edge,
 * so nothing downstream ever holds markup that could be rendered or executed by accident.
 */

/** Flattens HTML to readable text. Nothing is rendered, and no script survives. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ParsedAddress {
  name: string | null;
  address: string;
}

/**
 * Parses an RFC 5322 address header — `"Kumar, Ramesh" <r@x.in>, ops@y.in` — into addresses.
 *
 * Commas inside quotes or angle brackets do not split. An entry with no recognisable address is
 * dropped rather than stored as something it is not.
 */
export function parseAddressList(header: string | null | undefined): ParsedAddress[] {
  if (!header) return [];
  const entries: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const char of header) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === '<' && !inQuotes) inAngle = true;
    else if (char === '>' && !inQuotes) inAngle = false;
    if (char === ',' && !inQuotes && !inAngle) {
      entries.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  entries.push(current);

  return entries.flatMap((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return [];
    const angle = /^(.*)<([^>]+)>\s*$/.exec(trimmed);
    const address = (angle ? angle[2]! : trimmed).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) return [];
    const name = angle ? angle[1]!.trim().replace(/^"(.*)"$/, '$1').trim() || null : null;
    return [{ name, address }];
  });
}

/** Decodes base64url (Gmail's encoding for bodies and attachments) to bytes. */
export function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}
