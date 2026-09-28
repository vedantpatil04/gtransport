import { InboxClassification } from '@prisma/client';
import { z } from 'zod';

/**
 * Asking a model what an email is about.
 *
 * The contract is narrow on purpose. The model classifies, summarises, and lists references it
 * can see in the text — and that is all. It is never asked what to do about the mail, and nothing
 * it returns is written into a financial or vehicle record (§21). A person reads the summary and
 * decides.
 */

export const EMAIL_CLASSIFICATION_PROMPT = `
You are triaging an email that arrived at the shared mailbox of an Indian road-transport company.

Return ONLY valid JSON matching the requested structure. No markdown fences, no commentary.

Classify the email into exactly one category:
- DOCUMENT             — a vehicle or driver document: insurance, permit, fitness, PUC, licence
- SERVICE_INVOICE      — a garage or service centre invoice for vehicle work
- PAYMENT_NOTIFICATION — a bank, UPI or payment-gateway notice about money moving
- SUPPLIER             — a supplier, vendor or fuel station communication
- CUSTOMER_ENQUIRY     — a customer asking about a booking, consignment or quote
- OPERATIONAL          — routine operational mail that fits none of the above
- SPAM                 — marketing, phishing or otherwise unwanted
- UNCLASSIFIED         — you genuinely cannot tell

Also return:
- confidence: a number from 0 to 1 reflecting how sure the category is
- summary: at most three short sentences an office manager could read instead of the email
- references: identifiers the email plainly states, each with a type and the exact text
    types: invoice_number, vehicle_registration, amount, policy_number, date, reference
- warnings: brief notes about anything ambiguous, contradictory or suspicious

Rules:
1. Never invent a reference. If the email does not state it, leave it out.
2. Copy references exactly as written; do not reformat, correct or complete them.
3. The summary describes what the email says. It never recommends an action.
4. If the email asks for payment or bank-detail changes, say so in warnings — a person will
   decide, and this system never acts on such a request.
5. Your output is a suggestion for a human reviewer, not a decision.
`.trim();

export const EmailReferenceSchema = z
  .object({
    type: z.enum(['invoice_number', 'vehicle_registration', 'amount', 'policy_number', 'date', 'reference']),
    value: z.string().trim().min(1).max(120),
  })
  .strict();

export const EmailClassificationSchema = z
  .object({
    classification: z.nativeEnum(InboxClassification),
    confidence: z.number().min(0).max(1),
    summary: z.string().trim().max(2_000),
    references: z.array(EmailReferenceSchema).max(25),
    warnings: z.array(z.string().trim().max(300)).max(10),
  })
  .strict();

export type EmailClassificationResult = z.infer<typeof EmailClassificationSchema>;

/**
 * Whether a classification should be applied to the message.
 *
 * A human classification always wins. A model that later reads the mail differently records its
 * own result — which stays visible — but does not overwrite what a person decided (§21, §29).
 */
export function mayApplyClassification(message: { classifiedById: string | null }): boolean {
  return message.classifiedById === null;
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
