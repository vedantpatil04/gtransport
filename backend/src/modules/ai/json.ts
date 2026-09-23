export function parseJsonObject(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) return value;
  if (typeof value !== 'string') throw new Error('AI output was not JSON or a JSON string');

  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  if (!trimmed) throw new Error('AI returned an empty response');

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('AI returned malformed JSON');
  }
}
