import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { getEnv } from "@/lib/env";

let client: BedrockRuntimeClient | undefined;

// Every Bedrock call must use getEnv().BEDROCK_MODEL_ID, temperature 0 and JSON-schema output.
export function getBedrockClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: getEnv().AWS_REGION });
  return client;
}
