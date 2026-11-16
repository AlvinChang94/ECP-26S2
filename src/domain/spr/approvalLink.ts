// What: creates and checks the signed, expiring token inside an SPR approval link (pure: the secret and the time are passed in).
// Who calls it: the SPR service when it writes a link to the Outbox and when someone opens one.
// To extend: "single use" is enforced by the service with the ApprovalToken table; this file covers signature and expiry.
import { createHmac, timingSafeEqual } from "node:crypto";

export type ApprovalTokenPayload = {
  sprNo: string;
  /** Name of the person the link was sent to. They become "decided by". */
  recipient: string;
  /** ISO date-time after which the link no longer works. */
  expiresAt: string;
  /** A random value so that two links for the same SPR and person differ. */
  nonce: string;
};

export type TokenCheck = { ok: true; payload: ApprovalTokenPayload } | { ok: false; reason: "malformed" | "tampered" | "expired" };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** token = base64url(JSON payload) + "." + HMAC-SHA256 of that text. Readable, but cannot be changed without the secret. */
export function createApprovalToken(payload: ApprovalTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyApprovalToken(token: string, secret: string, now: Date): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  // timingSafeEqual needs equal lengths; a different length is a wrong signature anyway.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "tampered" };

  let payload: ApprovalTokenPayload;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ApprovalTokenPayload>;
    if (typeof parsed.sprNo !== "string" || typeof parsed.recipient !== "string" || typeof parsed.expiresAt !== "string" || typeof parsed.nonce !== "string") {
      return { ok: false, reason: "malformed" };
    }
    payload = { sprNo: parsed.sprNo, recipient: parsed.recipient, expiresAt: parsed.expiresAt, nonce: parsed.nonce };
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return { ok: false, reason: "malformed" };
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
