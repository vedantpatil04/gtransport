/**
 * Canonical extraction instructions shared by every receipt AI provider.
 * Provider adapters may wrap this prompt in their native request format, but
 * they must not rewrite the extraction rules.
 */
export const SERVICE_RECEIPT_EXTRACTION_PROMPT = `
You are extracting structured data from a service/repair receipt for a transport fleet.

Return ONLY valid JSON matching the requested receipt extraction structure.
Do not use markdown fences. Do not add commentary outside the JSON object.

Extract when clearly present:
- vendorName
- invoiceNumber
- invoiceDate
- vehicleNumber
- serviceType
- parts[] with name, quantity, unitPrice, amount
- partsAmount
- labourAmount
- gstAmount
- otherCharges
- subtotal
- totalAmount
- confidence as a number from 0 to 1
- rawText containing the readable receipt text you used
- warnings containing concise notes about ambiguity, missing fields, or low-quality text

Rules:
1. Never invent or guess missing information.
2. Unknown text values must be null.
3. Unknown numeric values must be null.
4. Use numbers for numeric amounts, without currency symbols or commas.
5. Keep invoiceDate in ISO format YYYY-MM-DD when the receipt provides enough information to determine it; otherwise use null.
6. Preserve the vehicle registration number exactly when legible, while normalizing obvious spacing only when it is unambiguous.
7. Confidence must reflect the reliability of the complete extraction, not just one field.
8. If the receipt contains contradictory values, prefer the clearest printed value and add a warning.
9. The AI output is an assistant suggestion. A human admin will review and confirm every field before the service record becomes final.
`.trim();
