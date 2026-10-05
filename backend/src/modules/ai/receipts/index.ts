/**
 * What the rest of the application may take from this folder.
 *
 * Only the two pure modules are re-exported. The services are provided by `AiModule` and injected,
 * so they have no business in a barrel file, and the presenter belongs to the controller. The
 * receipt status type is the one generated from the database enum (`@prisma/client`) — there is
 * no second, hand-written copy of it anywhere.
 */
export * from './extraction-review';
export * from './receipt-state';
