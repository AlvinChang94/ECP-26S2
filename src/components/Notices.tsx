// What: shows the red error or green success message that a server action left in the address (?error= or ?notice=).
// Who calls it: pages, right under their header.
// To extend: nothing; actions produce these messages through runAction() in src/app/_lib/forms.ts.
import type { PageMessages } from "@/app/_lib/forms";

export function Notices({ messages }: { messages: PageMessages }) {
  return (
    <>
      {messages.error ? (
        <div className="notice notice-error" role="alert">
          {messages.error}
        </div>
      ) : null}
      {messages.notice ? (
        <div className="notice notice-success" role="status">
          {messages.notice}
        </div>
      ) : null}
    </>
  );
}
