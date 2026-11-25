// What: keeps PDF bytes in an Amazon S3 bucket instead of a local folder (same FileStore interface as LocalFileStore).
// Who calls it: buildDeps()/getDeps() in src/services/deps.ts when STORAGE_BACKEND=s3. Intake writes uploads; the PDF route and extractors read them.
// To extend: the bucket itself (encryption, versioning, no public access) is set up in infra/orderflow.yaml, not here.
import { GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FileStore } from "./fileStore";

/** The one S3 call this class needs, so a test can pass a fake instead of a real client. */
export type S3Sender = Pick<S3Client, "send">;

export class S3FileStore implements FileStore {
  private readonly client: S3Sender;

  constructor(
    private readonly bucket: string,
    region: string,
    client?: S3Sender,
  ) {
    // Credentials are never passed in: the SDK finds them itself (the EC2 instance role on AWS, `aws configure` on a laptop).
    this.client = client ?? new S3Client({ region });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: checkedKey(key), Body: bytes, ContentType: contentTypeOf(key) }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkedKey(key) }));
    if (!result.Body) throw new Error(`S3 returned no content for ${key}.`);
    return result.Body.transformToByteArray();
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: checkedKey(key) }));
      return true;
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) return false;
      throw error;
    }
  }
}

/** Keys are relative paths such as "documents/ab12.pdf". Anything that looks like a path trick is refused, as in LocalFileStore. */
function checkedKey(key: string): string {
  if (key.length === 0 || key.startsWith("/") || key.split("/").includes("..") || key.includes("\\")) {
    throw new Error(`Not a valid file key: ${key}`);
  }
  return key;
}

function contentTypeOf(key: string): string {
  return key.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
}
