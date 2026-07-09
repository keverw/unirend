import type { RouteObject } from 'react-router';
import { Chat } from './pages/Chat';

// Single-page demo: the "/" route is server-rendered, then the client hydrates
// and the chat widget opens a WebSocket back to the same origin. Editing
// pages/Chat.tsx while the dev server runs demonstrates HMR.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Chat />,
  },
];
