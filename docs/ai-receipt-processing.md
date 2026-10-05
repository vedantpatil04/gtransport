# Gangamata Transport — Service Receipt AI

How a driver's photo of a workshop bill becomes an authoritative maintenance record. Code lives in
`backend/src/modules/ai/` (provider boundary, OCR, preparation) and `backend/src/modules/ai/receipts/`
(queue, worker, review, maintenance intelligence).

## The rule

AI output is a suggestion. A service record becomes authoritative only when a person submits the
figures and verifies it — and once they have, no rerun, retry or stale job can change it.
Re-opening a verified record is an explicit, audited act that requires a reason. Every reading is
kept as a version; none is ever replaced.

## Flow

```text
Driver uploads receipt  (POST /files/receipts → POST /operations/mine, category MAINTENANCE)
  → original stored unchanged in object storage (FileStorage); only metadata in PostgreSQL
  → maintenance record created (VehicleExpense), ledger posted with the driver's typed amount
  → AI job queued (service_receipt_ai_jobs, status QUEUED)          audit: service_receipt.uploaded
  → worker claims it (FOR UPDATE SKIP LOCKED)  → PROCESSING           audit: service_receipt.ai_processing
      prepare document   photo → as-is · PDF → own text layer (Poppler) + rendered pages
      OCR                Tesseract on photos / scanned pages when the document has no text
      provider           Ollama (default) or Dify — behind AIProvider
      parse + validate   Zod schema; anything else is INVALID_AI_OUTPUT, nothing stored
      app checks         totals add up, right vehicle, dates plausible, odometer not backwards
  → SUCCEEDED (coherent, confident) or NEEDS_REVIEW (low confidence, issues, model warnings)
                                                                      audit: service_receipt.ai_completed
  → on failure: RETRYING (new job, exponential backoff, up to AI_MAX_ATTEMPTS) or FAILED
                                                                      audit: service_receipt.ai_failed
  → admin reviews against the original, takes values across or corrects them
  → VERIFY (values written to the record, ledger re-synced)  or  REJECT
                                     audit: service_receipt.verified / .corrected / .extraction_rejected
```

## States

| State | Meaning | Who sets it |
|---|---|---|
| `NOT_PROCESSED` | No receipt, or predates AI | — |
| `QUEUED` | Job waiting for a worker | system |
| `PROCESSING` | OCR and provider call under way | system |
| `SUCCEEDED` | Extraction valid and coherent; still only a suggestion | system |
| `NEEDS_REVIEW` | Extraction valid but uncertain or contradictory | system |
| `FAILED` | No usable extraction; original intact; retry available | system |
| `RETRYING` | Failed, automatic retry scheduled | system |
| `VERIFIED` | A person verified the record — authoritative | person only |
| `REJECTED` | A person judged the extraction unusable | person only |

The transition table (`receipt-state.ts`) allows no automatic transition into `VERIFIED` or
`REJECTED`, and none out of them. The database refuses `VERIFIED` without a verifier and timestamp.

## What is extracted

`vendorName` (workshop), `invoiceNumber`, `invoiceDate` (service date), `vehicleNumber`,
`serviceType`, `odometerKm`, `nextServiceDate`, `nextServiceKm`, `lineItems[]` (`description`,
`kind` PART/LABOUR/OTHER, `quantity`, `unitPrice`, `amount`), `partsAmount`, `labourAmount`,
`gstAmount` (tax), `otherCharges`, `subtotal`, `totalAmount`, `confidence`, `rawText`, `warnings`.

Unknown values are `null`, never zero or today. The prompt forbids computing a next-service date
the receipt does not print, and the schema refuses a value like "about 48k km" rather than coercing
it. Extractions stored before line items were typed (`parts: [{ name … }]`) are read as PART lines.

## Verification

`POST /api/v1/service-receipts/:id/verify` writes exactly what the reviewer submitted: amount,
service date, workshop, note, and the structured details (invoice number, service type, odometer,
next service date/km, labour/parts/tax, line items). The server compares the submission with the
extraction version the reviewer worked from and records which fields were **accepted** (match the
reading) and which were **corrected** (differ) — a `service_receipt.corrected` audit entry is written
whenever anything was corrected. A changed amount or date moves the expense's finance-ledger line in
the same transaction.

Roles: review is open to office roles; verify/reject/retry to ADMIN, MANAGER and ACCOUNTING;
re-open to ADMIN and MANAGER; drivers only see their own uploads as five plain states.

## OCR

`OCR_ENGINE=auto` (default) runs Tesseract when installed and otherwise lets the vision model read
the image (stated at boot). `OCR_ENGINE=tesseract` makes OCR mandatory — a receipt that needs it
fails with `PREPROCESSING_FAILED` until the engine is installed. `none` switches it off. OCR text is
handed to the provider beside the image as a machine reading that may contain errors; the stored
result records how the receipt was read (`image+ocr`, `pdf:text`, `pdf:raster+ocr`, …). HEIC photos
cannot be OCR'd and are read by the model directly, with a warning.

## Providers

`AI_PROVIDER=ollama` (default) uses `/api/chat` with JSON mode and base64 images; it needs a
vision-capable model pulled on the Ollama server. `AI_PROVIDER=dify` uploads the original to Dify
and runs a published workflow with inputs `receipt_file`, `extraction_instructions`,
`vehicle_context`, `document_text` and `ocr_text`, returning the extraction JSON as
`outputs.result`. Business code only ever calls `ReceiptAIService`; switching provider is a
configuration change. Email classification uses the same provider through `processText`.

## Maintenance intelligence

`GET /service-receipts/maintenance/summary` and `/maintenance/vehicles/:id` compute, from
**verified** service records only:

- **upcoming / overdue service** — from the newest verified record's printed next-service date (and
  distance, reported but never assessed without a current odometer); otherwise an estimate from past
  intervals, labelled as such;
- **repeated issues** — the same part, labour item or service type on two or more verified invoices
  within 180 days;
- **service frequency** — services in the last 90 / 365 days and the average interval;
- **recent maintenance** — the latest verified services.

Everything is an observation. Nothing books work, authorises a repair or judges a vehicle's safety.

## Running the worker

By default the API process drains the queue (`AI_WORKER_ENABLED=true`). To run it elsewhere, set it
to `false` and schedule `npm run ai:worker`. Jobs are PostgreSQL rows claimed with `SKIP LOCKED`, so
any number of workers can run without two reading the same receipt, and a crashed worker's job is
reclaimed when its claim goes stale.
