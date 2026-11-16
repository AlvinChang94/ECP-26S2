// What: the InboxSource interface (where forwarded PDFs wait) and a folder-based implementation that simulates email and WhatsApp.
// Who calls it: the intake service, when it lists and imports waiting documents.
// To extend: a real mailbox (for example SES inbound email to S3) is another InboxSource; see docs/AWS_MAPPING.md.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type InboxMessage = {
  /** Unique within the source. For the folder source this is the file name. */
  id: string;
  fileName: string;
  channel: "email" | "whatsapp";
  sender: string | null;
  /** When the message arrived, if known. */
  receivedAt: Date | null;
};

export interface InboxSource {
  list(): Promise<InboxMessage[]>;
  read(id: string): Promise<Uint8Array>;
}

const ManifestSchema = z.object({
  messages: z.array(
    z.object({
      file: z.string(),
      channel: z.enum(["email", "whatsapp"]),
      sender: z.string(),
      receivedAt: z.string(),
    }),
  ),
});

/**
 * Every PDF in a folder is a waiting message. An optional manifest.json says which channel it came by,
 * who sent it and when; a PDF that is not in the manifest counts as an email from an unknown sender.
 */
export class FolderInboxSource implements InboxSource {
  constructor(private readonly dir: string) {}

  async list(): Promise<InboxMessage[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((name) => name.toLowerCase().endsWith(".pdf")).sort();
    } catch {
      return []; // the folder does not exist: nothing is waiting
    }
    const manifest = await this.readManifest();
    return names
      .map((name) => {
        const entry = manifest.get(name);
        return {
          id: name,
          fileName: name,
          channel: entry?.channel ?? ("email" as const),
          sender: entry?.sender ?? null,
          receivedAt: entry ? new Date(entry.receivedAt) : null,
        };
      })
      .sort((a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0) || a.fileName.localeCompare(b.fileName));
  }

  async read(id: string): Promise<Uint8Array> {
    // The id is a plain file name; anything with a path separator is refused.
    if (id !== path.basename(id)) throw new Error(`Not an inbox file name: ${id}`);
    return new Uint8Array(await readFile(path.join(this.dir, id)));
  }

  private async readManifest(): Promise<Map<string, { channel: "email" | "whatsapp"; sender: string; receivedAt: string }>> {
    try {
      const parsed = ManifestSchema.safeParse(JSON.parse(await readFile(path.join(this.dir, "manifest.json"), "utf8")));
      if (!parsed.success) return new Map();
      return new Map(parsed.data.messages.map((message) => [message.file, message]));
    } catch {
      return new Map(); // no manifest: every file gets the defaults
    }
  }
}
