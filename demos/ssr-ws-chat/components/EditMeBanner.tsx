// ─── EDIT ME ──────────────────────────────────────────────────────────────────
// Change the words in EDITABLE_LINE while `bun run ssr-ws-chat:serve:dev` is
// running and save. React Fast Refresh hot-updates just this component, so the
// banner text changes without a page reload.
//
// This banner is deliberately its own module and does NOT own the chat
// WebSocket. The socket lives in pages/Chat.tsx, a separate module, so editing
// this file does not re-run Chat's effect — the chat connection and messages
// stay intact. (Editing pages/Chat.tsx itself would reconnect the socket, since
// Fast Refresh re-runs that module's effects.)
const EDITABLE_LINE =
  'Edit this sentence in components/EditMeBanner.tsx and save. ✏️';

export function EditMeBanner() {
  return (
    <section className="edit-me">
      <span className="edit-me-tag">HMR check</span>
      <p className="edit-me-line">{EDITABLE_LINE}</p>
      <p className="edit-me-hint">
        If this text changes the moment you save (no page reload) while the chat
        below stays connected, HMR and the WebSocket are both working on the
        same port.
      </p>
    </section>
  );
}
