import { TextractClient } from "@aws-sdk/client-textract";
import { getEnv } from "@/lib/env";

let client: TextractClient | undefined;

export function getTextractClient(): TextractClient {
  client ??= new TextractClient({ region: getEnv().AWS_REGION });
  return client;
}
