import { InboxClassification, InboxSuggestionType } from '@prisma/client';
import { z } from 'zod';

/**
 * Asking a model what an email is about.
 *
 * The contract is narrow on purpose. The model classifies, summarises, lists references it can
 * see in the text, and may *suggest* a follow-up from a fixed list. That is all. Nothing it
 * returns is written into a financial, payment, maintenance or compliance record, and a
 * suggestion does nothing until a person accepts it (§21).
 */

export const EMAIL_CLASSIFICATION_PROMPT = `
You are triaging an email that arrived at the shared mailbox of an Indian road-transport company.

Return ONLY valid JSON matching the requested structure. No markdown fences, no commentary.

Classify the email into exactly one category:
- VEHICLE_DOCUMENT — vehicle papers: RC, insurance policy or renewal, permit, fitness, PUC
- FUEL             — fuel station bills, fuel card statements
- MAINTENANCE      — workshop or service-centre invoices, job cards, repair estimates
- FINANCE          — loans, EMIs, bank statements, GST or tax correspondence
- SALARY_PAYMENT   — salary, advances, payouts, payment or UPI notifications
- COMPLIANCE       — traffic challans, RTO notices, licence or regulatory correspondence
- VENDOR           — any other supplier or vendor communication
- CUSTOMER         — a customer: bookings, consignments, quotes, complaints
- GENERAL          — routine mail that fits none of the above
- SPAM             — marketing, phishing or otherwise irrelevant
- UNCLASSIFIED     — you genuinely cannot tell

Also return:
- confidence: a number from 0 to 1 reflecting how sure the category is
- summary: at most three short sentences an office manager could read instead of the email
- references: identifiers the email plainly states, each with a type and the exact text
    types: invoice_number, vehicle_registration, amount, policy_number, date, reference
- suggestedActions: at most 3 follow-ups a person might take, each with
    type: one of CREATE_SERVICE_RECORD (a workshop invoice to record as a service),
          REVIEW_VEHICLE_DOCUMENT, REVIEW_COMPLIANCE, RECORD_FUEL_EXPENSE, REVIEW_FINANCE, REVIEW_PAYMENT
    reason: one short sentence
    attachment: the exact filename of the attachment it concerns, or null
    vehicleRegistration, amount, date (YYYY-MM-DD), reference: values the email plainly states, or null
- warnings: brief notes about anything ambiguous, contradictory or suspicious

Rules:
1. Never invent a reference or a value. If the email does not state it, use null or leave it out.
2. Copy references exactly as written; do not reformat, correct or complete them.
3. The summary describes what the email says. It never recommends an action.
4. Suggest an action only when the email clearly calls for it. Spam gets none.
5. If the email asks for payment or bank-detail changes, say so in warnings — a person will
   decide, and this system never acts on such a request.
6. Your output is a suggestion for a human reviewer, not a decision.
`.trim();

export const EmailReferenceSchema = z
  .object({
    type: z.enum(['invoice_number', 'vehicle_registration', 'amount', 'policy_number', 'date', 'reference']),
    value: z.string().trim().min(1).max(120),
  })
  .strict();

const nullableText = (max: number) =>
  z.preprocess((value) => (value === '' || value === undefined ? null : value), z.string().trim().max(max).nullable());

const nullableAmount = z.preprocess((value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[₹,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().nonnegative().nullable());

export const SuggestedActionSchema = z
  .object({
    type: z.nativeEnum(InboxSuggestionType),
    reason: z.string().trim().min(1).max(300),
    attachment: nullableText(255).default(null),
    vehicleRegistration: nullableText(32).default(null),
    amount: nullableAmount.default(null),
    date: z.preprocess((value) => (value === '' || value === undefined ? null : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).default(null),
    reference: nullableText(120).default(null),
  })
  .strict();

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

export const EmailClassificationSchema = z
  .object({
    classification: z.nativeEnum(InboxClassification),
    confidence: z.number().min(0).max(1),
    summary: z.string().trim().max(2_000),
    references: z.array(EmailReferenceSchema).max(25),
    suggestedActions: z.array(SuggestedActionSchema).max(3).default([]),
    warnings: z.array(z.string().trim().max(300)).max(10),
  })
  .strict();

export type EmailClassificationResult = z.infer<typeof EmailClassificationSchema>;

/**
 * Whether a classification should be applied to the message.
 *
 * A human classification always wins. A model that later reads the mail differently records its
 * own result — which stays visible — but does not overwrite what a person decided (§21, §29). And
 * a reading below the confidence floor is recorded but not applied: the message stays UNCLASSIFIED
 * for a person to sort, rather than being filed under a guess.
 */
export function mayApplyClassification(message: { classifiedById: string | null }, confidence = 1, minConfidence = 0): boolean {
  return message.classifiedById === null && confidence >= minConfidence;
}

/**
 * The suggestions worth keeping from a reading.
 *
 * Spam and unclassifiable mail suggest nothing; a low-confidence reading suggests nothing; and a
 * repeated type is kept once. The values in each are the model's reading of the text — prefill
 * for a person to check, never applied.
 */
export function suggestionsToKeep(result: EmailClassificationResult, minConfidence: number): SuggestedAction[] {
  if (result.classification === InboxClassification.SPAM || result.classification === InboxClassification.UNCLASSIFIED) return [];
  if (result.confidence < minConfidence) return [];
  const seen = new Set<InboxSuggestionType>();
  return result.suggestedActions.filter((action) => {
    if (seen.has(action.type)) return false;
    seen.add(action.type);
    return true;
  });
}

/**
 * The text handed to the model.
 *
 * Capped, because a long marketing email would otherwise push the useful part out of the context
 * window, and because sending an unbounded body to a model is not a cost anyone chose.
 */
export function buildClassificationInput(message: {
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  attachments: { filename: string; mimeType: string }[];
}, maxChars = 8_000): string {
  const lines = [
    `From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`,
    `Subject: ${message.subject ?? '(no subject)'}`,
  ];
  if (message.attachments.length) {
    lines.push(`Attachments: ${message.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(', ')}`);
  }
  lines.push('', (message.bodyText ?? '(no readable body)').slice(0, maxChars));
  return lines.join('\n');
}
