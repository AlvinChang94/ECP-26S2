# From the local proof of concept to AWS

The proof of concept runs on one laptop with no AWS account. Every place where the deck names an AWS service is an **adapter** behind an interface in `src/adapters`. Moving to AWS means writing a second implementation of an interface and returning it from `getDeps()` in `src/services/deps.ts`. Services, domain rules and pages do not change.

**Nothing in this file is implemented.** It is the plan.

| Deck service | Interface in the code | POC implementation | AWS implementation to write |
|---|---|---|---|
| Amazon S3 | `FileStore` (`src/adapters/fileStore.ts`) | `LocalFileStore`: files under `storage/` | `S3FileStore`: `put` = PutObject, `get` = GetObject, `exists` = HeadObject. Keys stay the same (`documents/<sha256>.pdf`). |
| Amazon Textract + Amazon Bedrock | `DocumentExtractor` (`src/adapters/extractor/types.ts`) | `DefaultExtractor`: pdf.js text with positions, keyword classifier, label rules. Optional `LlmExtractor` (Anthropic API). | `TextractBedrockExtractor`: Textract returns words with bounding boxes (the same page-fraction convention our `BoundingBox` uses); Bedrock turns them into the fixed fields. Keep the Zod check and the grounding check from `LlmExtractor`. |
| Amazon SES + Amazon SNS | `Notifier` (`src/adapters/notifier.ts`) | `OutboxNotifier`: writes a row in the Outbox table, shown on the Outbox page | `SesSnsNotifier`: `channel: "email"` goes to SES SendEmail, `channel: "chat"` to an SNS topic. Keep writing the Outbox row first, as the audit trail and for de-duplication. |
| Amazon EventBridge Scheduler | `runDueJobs(deps, now)` (`src/services/jobs.ts`) | Called by the "Run due jobs" button and when the demo clock moves | A schedule (for example every 15 minutes) invokes a Lambda that calls `runDueJobs`. The 24, 48 and 72 hour SPR reminders are rows in `ScheduledJob`; one-time EventBridge schedules per SPR are an alternative. |
| AWS Step Functions | SPR state machine (`src/domain/spr/stateMachine.ts`) | A pure function decides the next state; the service stores it | Either keep the pure function (simplest), or model Draft, Submitted, Approved, Rejected as a Step Functions workflow that waits for the approval callback. |
| AWS Lambda | Service functions (`src/services/*.ts`) | Called from server actions inside the Next.js server | Each background use case (run due jobs, process an inbound email) becomes a Lambda handler that builds `Deps` and calls the same service function. |
| Amazon Cognito | `getPersona()` (`src/app/_lib/session.ts`) | A cookie set by the persona picker; no password | Read the signed-in user from the Cognito session and map their group to one of the five roles. |
| Amazon RDS for MySQL | Prisma (`prisma/schema.prisma`, `src/adapters/db.ts`) | SQLite file `storage/orderflow.db` | See "move from SQLite to MySQL" in DEVELOPER_GUIDE.md. |
| (email and WhatsApp intake) | `importInbox` (`src/services/intake.ts`) | Reads PDFs from `data/inbox/` | SES inbound email to S3 plus a Lambda that calls the same intake service. WhatsApp needs the WhatsApp Business API or a shared mailbox; not decided. |

## Using Claude through Amazon Bedrock

The optional LLM extractor calls the Anthropic API directly. To use Bedrock instead, change only how the client is created in `createAnthropicReader()` (`src/adapters/extractor/llm/index.ts`):

```ts
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
const client = new AnthropicBedrockMantle({ awsRegion: "ap-southeast-1" });
// Bedrock model ids take a prefix, for example "anthropic.claude-opus-5-5".
```

The server-side `fallbacks` parameter is not available on Bedrock; remove it there (or use the SDK's client-side refusal fallback).

## What stays the same

- `src/domain`: every rule, flag, template and state machine.
- `src/services`: every use case.
- `src/app`: every page and action.
- The tests: unit and integration tests run against the local adapters; add contract tests for each new AWS adapter.
