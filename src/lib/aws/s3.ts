import { S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/lib/env";

let client: S3Client | undefined;

// Credentials come from the SDK default chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env).
export function getS3Client(): S3Client {
  client ??= new S3Client({ region: getEnv().AWS_REGION });
  return client;
}
