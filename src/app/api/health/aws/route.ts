import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { connection } from "next/server";
import { getBedrockClient, getS3Client } from "@/lib/aws";
import { getEnv } from "@/lib/env";

type Check = { ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string };

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, latencyMs: Date.now() - start, error };
  }
}

export async function GET() {
  await connection(); // always run at request time, never prerendered
  const env = getEnv();

  const [s3, bedrock] = await Promise.all([
    timed(() =>
      getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, MaxKeys: 1 })),
    ),
    timed(async () => {
      // Minimal call that still follows the project rules: pinned model, temperature 0,
      // JSON-schema output (forced tool use).
      const res = await getBedrockClient().send(
        new ConverseCommand({
          modelId: env.BEDROCK_MODEL_ID,
          messages: [{ role: "user", content: [{ text: "Health check. Report ok=true." }] }],
          inferenceConfig: { temperature: 0, maxTokens: 64 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: "report_health",
                  description: "Report that the model is reachable.",
                  inputSchema: {
                    json: {
                      type: "object",
                      properties: { ok: { type: "boolean" } },
                      required: ["ok"],
                    },
                  },
                },
              },
            ],
            toolChoice: { tool: { name: "report_health" } },
          },
        }),
      );
      const toolUse = res.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
      if (!toolUse) throw new Error("Bedrock returned no structured output");
    }),
  ]);

  const ok = s3.ok && bedrock.ok;
  return Response.json({ ok, region: env.AWS_REGION, s3, bedrock }, { status: ok ? 200 : 503 });
}
