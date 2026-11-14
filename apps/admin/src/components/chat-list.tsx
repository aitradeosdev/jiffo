/** One message in an errand's chat, as the admin API returns it. */
export interface ChatMessage {
  id: number;
  senderRole: string;
  kind: string;
  body: string;
  photoUrl: string | null;
  createdAt: string;
}

/** Who wrote a message or did something, as staff see it. */
export const WHO: Record<string, string> = { customer: 'Customer', agent: 'Agent', system: 'Jiffo', admin: 'Support' };

/**
 * An errand's chat for staff. Messages are shown as text only, never as markup (docs/security-plan.md, C6, R7):
 * whatever a customer or agent typed can't run in a staff member's browser.
 */
export function ChatList({ chat, time }: { chat: ChatMessage[]; time: (iso: string) => string }) {
  if (chat.length === 0) return <p className="text-sm text-ink-3">No messages.</p>;
  return (
    <ol className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
      {chat.map((m) =>
        m.senderRole === 'system' ? (
          <li key={m.id} className="text-center text-[13px] text-ink-3">
            {m.body} · {time(m.createdAt)}
          </li>
        ) : (
          <li key={m.id} className={`flex ${m.senderRole === 'agent' ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                m.senderRole === 'agent' ? 'bg-surface-2' : 'bg-ink text-on-ink'
              }`}
            >
              <p className="text-[11px] font-bold tracking-wide uppercase opacity-70">{WHO[m.senderRole]}</p>
              {m.photoUrl ? (
                <a href={m.photoUrl} target="_blank" rel="noreferrer">
                  <img src={m.photoUrl} alt="Photo sent in chat" className="mt-1 max-h-48 rounded-lg" />
                </a>
              ) : (
                <p className="text-[15px] whitespace-pre-wrap">{m.body}</p>
              )}
              <p className="mt-0.5 text-[11px] opacity-60">{time(m.createdAt)}</p>
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
