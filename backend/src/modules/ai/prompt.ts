/**
 * Canonical extraction instructions shared by every receipt AI provider.
 * Provider adapters may wrap this prompt in their native request format, but
 * they must not rewrite the extraction rules.
 */
export const SERVICE_RECEIPT_EXTRACTION_PROMPT = `
You are extracting structured data from a service/repair receipt for an Indian road-transport fleet.

Return ONLY valid JSON matching the requested receipt extraction structure.
Do not use markdown fences. Do not add commentary outside the JSON object.

Extract when clearly present:
- vendorName: the workshop or service centre
- invoiceNumber: the invoice, bill or job-card number
- invoiceDate: the service / invoice date
- vehicleNumber: the vehicle registration on the receipt
- serviceType: e.g. "Periodic service", "Brake overhaul", "Clutch replacement"
- odometerKm: the odometer reading at the service, in kilometres (integer)
- nextServiceDate: the next-service date printed on the receipt
- nextServiceKm: the next-service odometer reading printed on the receipt, in kilometres
- lineItems[]: every billed line, each with description, kind ("PART", "LABOUR" or "OTHER"),
  quantity, unitPrice and amount
- partsAmount: the parts subtotal
- labourAmount: the labour subtotal
- gstAmount: the total tax (GST/CGST+SGST/IGST)
- otherCharges
- subtotal
- totalAmount: the amount payable
- confidence as a number from 0 to 1
- rawText containing the readable receipt text you used
- warnings containing concise notes about ambiguity, missing fields, or low-quality text

Rules:
1. Never invent or guess missing information. Do not compute a next service date or distance that
   is not printed on the receipt.
2. Unknown text values must be null.
3. Unknown numeric values must be null.
4. Use numbers for numeric amounts, without currency symbols or commas.
5. Keep invoiceDate and nextServiceDate in ISO format YYYY-MM-DD when the receipt provides enough
   information to determine them; otherwise use null.
6. Preserve the vehicle registration number exactly when legible, while normalizing obvious spacing only when it is unambiguous.
7. Use null for a line item's kind when the receipt does not make clear whether it is a part or labour.
8. Confidence must reflect the reliability of the complete extraction, not just one field.
9. If the receipt contains contradictory values, prefer the clearest printed value and add a warning.
10. OCR text, when supplied, is a machine reading and may contain recognition errors: prefer what
    the image shows where the two disagree, and add a warning.
11. The AI output is an assistant suggestion. A human admin will review and confirm every field before the service record becomes final.
`.trim();
