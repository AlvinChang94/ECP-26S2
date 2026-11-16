// What: shows the text of an Outbox message and turns web addresses in it into clickable links.
// Who calls it: the Outbox page (so an approval link can be opened straight from the message).
// To extend: nothing; it only displays text.

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

export function MessageBody({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part}>
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </div>
  );
}
