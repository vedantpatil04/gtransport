/** DI token for the active AIProvider. Business code never injects a concrete provider. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * DI token for the document preparer. Which implementation is bound depends on what the server
 * can actually do (see ai.module.ts), so the pipeline never claims a capability it lacks.
 */
export const DOCUMENT_PREPARER = Symbol('DOCUMENT_PREPARER');

/**
 * DI token for the local OCR engine, or null when OCR is switched off or not installed (and not
 * required). Bound in ai.module.ts according to OCR_ENGINE and what the host can actually run.
 */
export const OCR_ENGINE = Symbol('OCR_ENGINE');
