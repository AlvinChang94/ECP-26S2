# From the local proof of concept to AWS

The app runs on a laptop with no AWS account, and the same code runs on AWS. Every place where the deck names an AWS service is an **adapter** behind an interface in `src/adapters`; `getDeps()` in `src/services/deps.ts` picks the local or the AWS version from the settings. Services, domain rules and pages do not change.

**Built (stories 3 and 4):** Amazon S3, Amazon SES, Amazon RDS for MySQL and Amazon EventBridge Scheduler, created by CloudFormation ([infra/orderflow.yaml](../infra/orderflow.yaml)). How to deploy: [AWS_DEPLOY.md](AWS_DEPLOY.md). Why it is shaped this way: [ARCHITECTURE.md](ARCHITECTURE.md). The other rows are still the plan.

| Deck service | Status | Interface in the code | Local implementation | AWS implementation |
|---|---|---|---|---|
| Amazon S3 | **Built** | `FileStore` (`src/adapters/fileStore.ts`) | `LocalFileStore`: files under `storage/` | `S3FileStore` (`src/adapters/s3FileStore.ts`), `STORAGE_BACKEND=s3`: PutObject, GetObject, HeadObject. Keys stay the same (`documents/<sha256>.pdf`). Private, encrypted, versioned bucket. |
| Amazon Textract + Amazon Bedrock | Planned | `DocumentExtractor` (`src/adapters/extractor/types.ts`) | `DefaultExtractor`: pdf.js text with positions, keyword classifier, label rules. Optional `LlmExtractor` (Anthropic API). | `TextractBedrockExtractor`: Textract returns words with bounding boxes (the same page-fraction convention our `BoundingBox` uses); Bedrock turns them into the fixed fields. Keep the Zod check and the grounding check from `LlmExtractor`. |
| Amazon SES (+ SNS) | **Built** (SES); SNS planned | `Notifier` (`src/adapters/notifier.ts`) | `OutboxNotifier`: writes a row in the Outbox table, shown on the Outbox page | `SesNotifier` (`src/adapters/sesNotifier.ts`), `NOTIFIER=ses`: writes the Outbox row first (audit trail, de-duplication), then SES SendEmail; the result is stored on the row. The warehouse message also goes by email; an SNS topic for a team channel is a later step. |
| Amazon EventBridge Scheduler | **Built** | `runDueJobs(deps, now)` (`src/services/jobs.ts`) | Called by the "Run due jobs" button and when the demo clock moves | A schedule (every 5 minutes) runs one Systems Manager command on the server, which calls `POST /api/jobs/run` on localhost with a shared secret. The 24, 48 and 72 hour SPR reminders stay rows in `ScheduledJob`. |
| AWS Step Functions | Not needed yet | SPR state machine (`src/domain/spr/stateMachine.ts`) | A pure function decides the next state; the service stores it | Either keep the pure function (simplest), or model Draft, Submitted, Approved, Rejected as a Step Functions workflow that waits for the approval callback. |
| AWS Lambda | Not used | Service functions (`src/services/*.ts`) | Called from server actions inside the Next.js server | Each background use case (run due jobs, process an inbound email) becomes a Lambda handler that builds `Deps` and calls the same service function. |
| Amazon Cognito | Planned | `getPersona()` (`src/app/_lib/session.ts`) | A cookie set by the persona picker; no password | Read the signed-in user from the Cognito session and map their group to one of the five roles. |
| Amazon RDS for MySQL | **Built** | Prisma (`prisma/schema.prisma`, `src/adapters/db.ts`) | SQLite file `storage/orderflow.db` | `DATABASE_URL=mysql://...`: `createDb()` uses the MySQL driver over TLS. The MySQL schema (`prisma/mysql/`) is generated from the SQLite one. Private subnets, encrypted, password in Secrets Manager. |
| (email and WhatsApp intake) | Planned | `importInbox` (`src/services/intake.ts`) | Reads PDFs from `data/inbox/` | SES inbound email to S3 plus a Lambda that calls the same intake service. WhatsApp needs the WhatsApp Business API or a shared mailbox; not decided. |

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
