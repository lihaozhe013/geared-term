import { IdSchema } from '@geared-term/protocol';
import { z } from 'zod';

export const SessionKindSchema = z.enum(['local', 'wsl', 'ssh']);
export const SessionStateSchema = z.enum([
  'created',
  'starting',
  'awaiting-user',
  'running',
  'closing',
  'closed',
  'failed',
  'exited'
]);

export const SessionDescriptorSchema = z.object({
  id: IdSchema,
  kind: SessionKindSchema,
  name: z.string().min(1).max(160),
  group: z.string().max(160).optional(),
  term: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen'])
});

export type SessionKind = z.infer<typeof SessionKindSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionDescriptor = z.infer<typeof SessionDescriptorSchema>;

const transitions: Record<SessionState, readonly SessionState[]> = {
  created: ['starting', 'closing', 'closed'],
  starting: ['awaiting-user', 'running', 'failed', 'closing'],
  'awaiting-user': ['starting', 'running', 'failed', 'closing'],
  running: ['exited', 'closing', 'failed'],
  exited: ['closed'],
  closing: ['closed', 'failed'],
  failed: ['closed'],
  closed: []
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return transitions[from].includes(to);
}

export function transitionSession(from: SessionState, to: SessionState): SessionState {
  if (from === to || canTransition(from, to)) {
    return to;
  }

  throw new Error(`Invalid session transition: ${from} -> ${to}`);
}

export function normalizeSessionName(
  kind: SessionKind,
  value: string | undefined,
  fallback: string
): string {
  const name = value?.trim();
  if (name) {
    return name.slice(0, 160);
  }

  if (kind === 'ssh') {
    return fallback || 'SSH Session';
  }

  return fallback || (kind === 'wsl' ? 'WSL Session' : 'Local Shell');
}
