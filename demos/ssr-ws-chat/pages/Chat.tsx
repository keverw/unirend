import { useEffect, useRef, useState } from 'react';
import { EditMeBanner } from '../components/EditMeBanner';

const HEADING = 'Unirend SSR + WebSocket Chat';
const BLURB =
  'One page proving two things at once: Vite HMR and an application WebSocket sharing a single port. Try both below.';

// This component owns the chat WebSocket (see the useEffect below). To demo HMR
// while the connection stays alive, edit components/EditMeBanner.tsx — a
// separate module — not this file. Editing this file re-runs the effect below,
// which reconnects the socket (React Fast Refresh remounts a module's effects).

type ChatMessage = {
  id: number;
  who: 'you' | 'server';
  text: string;
};

type ConnectionState = 'connecting' | 'open' | 'closed';

function echoSocketURL(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/echo`;
}

export function Chat() {
  const [status, setStatus] = useState<ConnectionState>('connecting');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const nextID = useRef(0);

  const addMessage = (who: ChatMessage['who'], text: string) => {
    setMessages((prev) => [...prev, { id: nextID.current++, who, text }]);
  };

  useEffect(() => {
    // Runs only in the browser after hydration.
    const socket = new WebSocket(echoSocketURL());
    socketRef.current = socket;

    // In dev, StrictMode runs this effect setup → cleanup → setup, so an old
    // socket's async events (e.g. onclose) can arrive after we've replaced it.
    // Ignore any event whose socket is no longer the current one, otherwise a
    // stale onclose would flip status back to "closed" over a live connection.
    const isCurrent = () => socketRef.current === socket;

    socket.onopen = () => {
      if (isCurrent()) {
        setStatus('open');
      }
    };

    socket.onclose = () => {
      if (isCurrent()) {
        setStatus('closed');
      }
    };

    socket.onmessage = (event) => {
      if (!isCurrent()) {
        return;
      }

      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          message?: string;
          original?: string;
        };

        if (payload.type === 'echo' && payload.original !== undefined) {
          addMessage('server', payload.original);
        } else if (payload.message) {
          // welcome / initial-echo frames carry a human-readable message.
          addMessage('server', payload.message);
        }
      } catch {
        addMessage('server', String(event.data));
      }
    };

    return () => {
      socket.close();

      // Only drop the ref if it still points at this socket, so a re-mount that
      // has already installed a newer socket isn't clobbered.
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, []);

  const send = () => {
    const text = draft.trim();
    const socket = socketRef.current;

    if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    addMessage('you', text);
    socket.send(text);
    setDraft('');
  };

  return (
    <main className="chat">
      <h1>{HEADING}</h1>
      <p className="blurb">{BLURB}</p>

      <EditMeBanner />

      <h2 className="section-title">Echo chat (WebSocket)</h2>
      <div className="status" data-state={status}>
        WebSocket: <strong>{status}</strong>
      </div>

      <ul className="log" aria-label="chat messages">
        {messages.length === 0 && (
          <li className="hint">Say something and the server echoes it back.</li>
        )}
        {messages.map((message) => (
          <li key={message.id} className={`msg ${message.who}`}>
            <span className="who">
              {message.who === 'you' ? 'You' : 'Echo'}
            </span>
            <span className="text">{message.text}</span>
          </li>
        ))}
      </ul>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message…"
          aria-label="message"
        />
        <button type="submit" disabled={status !== 'open'}>
          Send
        </button>
      </form>
    </main>
  );
}
