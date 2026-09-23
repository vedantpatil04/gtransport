/** Env files in precedence order (first match wins; real environment variables always win). */
export function envFilePaths(nodeEnv = process.env.NODE_ENV ?? 'development'): string[] {
  return [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env.local', '.env'];
}
