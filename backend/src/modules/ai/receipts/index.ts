/**
 * What the rest of the application may take from this folder.
 *
 * Only the two pure modules are re-exported. The services are provided by `AiModule` and injected,
 * so they have no business in a barrel file, and the presenter belongs to the controller.
 *
 * `ai-status.ts`, `workflow.ts`, `worker.ts`, `admin-verification.ts` and `retry.ts` are the Phase 0
 * sketches of this folder, kept as the record of the intended design. They are deliberately no
 * longer re-exported: their `ServiceReceiptAIStatus` names only six states, where the database enum
 * has nine (it is missing NOT_PROCESSED, RETRYING and REJECTED — the last of which is what makes a
 * rejected extraction distinguishable from a rejected expense). Two different types under one name
 * in one directory is a mistake waiting to be imported, so the real one, from `@prisma/client`, is
 * the only one reachable through here.
 */
export * from './extraction-review';
export * from './receipt-state';
