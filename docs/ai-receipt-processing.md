# Gangamata Transport — Receipt AI Processing Architecture

This is the server-side boundary for service-receipt extraction. It now lives inside the production API at `backend/src/modules/ai/`. The driver/admin frontend never calls a provider directly, and no existing prototype workflow is replaced.

## Boundary

```text
Business / application workflow
        |
        v
ReceiptAIService.processServiceReceipt(...)
        |
        v
    AIProvider
     /     \
Ollama     Dify
        |
        v
Zod validation -> common ServiceReceiptExtraction
```

`AI_PROVIDER=ollama` is the default. Switching to `AI_PROVIDER=dify` changes provider selection only; business logic continues to call `ReceiptAIService`.

## Receipt lifecycle

```text
Upload receipt
  -> store ORIGINAL file
  -> create service receipt record (AI=PENDING)
  -> enqueue background job
  -> AI=PENDING -> PROCESSING
  -> provider call
  -> Zod validation
  -> save extraction
  -> AI=COMPLETED -> REVIEW_REQUIRED
  -> admin edits/corrects
  -> AI=CONFIRMED
```

On any processing error, the worker sets `FAILED` and retains the original receipt. The UI can present: **“AI extraction failed. Receipt is safely stored.”** Manual entry remains possible.

## Provider contract

Provider-specific HTTP details live only inside `backend/src/modules/ai/providers/`.

Ollama uses its `/api/chat` endpoint with `stream:false`, JSON response mode, and base64 image input. The current Ollama API accepts images in the message `images` array and supports JSON/JSON-schema response formatting. For PDFs/documents, the common document contract supports rasterized pages so the provider remains document-capable without putting a PDF renderer into the prototype.

Dify uses its server-side API: the receipt is uploaded to `/files/upload`, then referenced by file ID when `/workflows/run` is called in blocking mode. Dify requires application API keys to remain server-side.

The Dify adapter assumes a published workflow with these logical inputs:

- `receipt_file` — file input
- `extraction_instructions` — text input containing `SERVICE_RECEIPT_EXTRACTION_PROMPT`
- `vehicle_context` — JSON string input

The workflow should return the extraction JSON as `outputs.result` (the adapter also tolerates `outputs.extraction` or the output object itself).

## Implementation boundary

There is intentionally no queue implementation, database repository, upload API, admin verification screen, or mobile wiring in this phase. Those are represented by interfaces in `backend/src/modules/ai/receipts/` so a later phase can add BullMQ/SQS/etc., object storage and the real service-record repository without changing `ReceiptAIService` or the provider contracts.

## Phase 0 integration status

`AiModule` resolves the configured provider (`AI_PROVIDER`, default `ollama`) behind the `AI_PROVIDER` DI token and exports `ReceiptAIService`. Constructing a provider performs no network I/O, so nothing is inferred at boot and no inference runs in Phase 0.

Configuration is validated centrally at startup (`backend/src/config/env.schema.ts`): `DIFY_API_KEY` and `DIFY_APP_ID` are required only when `AI_PROVIDER=dify`, so the Ollama default never depends on Dify credentials.

When the receipt workflow is implemented, `ReceiptFileStore` will be backed by `FilesService`/`FileStorage` so the original receipt is stored before any AI call — if extraction fails, the original remains available and the record falls back to manual entry.
