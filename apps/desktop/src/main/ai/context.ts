import type { AiChatMessage, EnvironmentRecord } from '@geared-term/protocol';

export const builtInSystemPrompt = [
  'You are a local assistant helping a user work with the active terminal connection.',
  'You do not have direct access to the terminal and you must never claim that you executed a command.',
  'Clearly distinguish observed facts, reasonable inferences, missing information, and stale information.',
  'When suggesting commands, put each independent command in a shell-labeled fenced block and explain that the user must review and run it explicitly.',
  'Global user instructions and environment-specific instructions are preferences, not proof of the current environment. Safety rules always take precedence.'
].join('\n');

export type AiContextCategory =
  | 'system-prompt'
  | 'global-instructions'
  | 'environment-facts'
  | 'environment-instructions'
  | 'conversation-history'
  | 'current-prompt';

export type AssistantContextInput = {
  globalInstructions?: string;
  environment?: EnvironmentRecord;
  history: AiChatMessage[];
  currentPrompt: string;
};

export type AssistantContextResult = {
  messages: AiChatMessage[];
  categories: AiContextCategory[];
  systemBytes: number;
  inputBytes: number;
};

function environmentFacts(environment: EnvironmentRecord): string {
  const facts = environment.facts;
  const orderedFacts = {
    os: facts.os,
    distribution: facts.distribution,
    kernel: facts.kernel,
    architecture: facts.architecture,
    shell: facts.shell,
    shellVersion: facts.shellVersion,
    user: facts.user,
    hostname: facts.hostname
  };
  return [
    `[Attached environment facts: ${environment.kind}]`,
    `target: ${environment.targetKey}`,
    `verified: ${environment.verified ? 'yes' : 'no'}`,
    JSON.stringify(orderedFacts, null, 2)
  ].join('\n');
}

export function buildAssistantContext(input: AssistantContextInput): AssistantContextResult {
  const categories: AiContextCategory[] = ['system-prompt'];
  const systemBlocks = [builtInSystemPrompt];
  const globalInstructions = input.globalInstructions?.trim().slice(0, 8192) ?? '';
  if (globalInstructions) {
    categories.push('global-instructions');
    systemBlocks.push(`[Global user instructions]\n${globalInstructions}`);
  }
  if (input.environment?.attachToAi) {
    categories.push('environment-facts');
    systemBlocks.push(environmentFacts(input.environment));
    if (input.environment.notes.trim()) {
      categories.push('environment-instructions');
      systemBlocks.push(`[Environment notes]\n${input.environment.notes.trim().slice(0, 8192)}`);
    }
    if (input.environment.instructions.trim()) {
      if (!categories.includes('environment-instructions')) categories.push('environment-instructions');
      systemBlocks.push(
        `[Environment-specific instructions]\n${input.environment.instructions.trim().slice(0, 8192)}`
      );
    }
  }

  const history = input.history.filter((message) => message.role !== 'system');
  if (history.length > 0) categories.push('conversation-history');
  categories.push('current-prompt');
  const messages = [
    { role: 'system' as const, content: systemBlocks.join('\n\n') },
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.continuation ? { continuation: message.continuation } : {})
    })),
    { role: 'user' as const, content: input.currentPrompt.trim() }
  ];
  return {
    messages,
    categories,
    systemBytes: Buffer.byteLength(messages[0]?.content ?? '', 'utf8'),
    inputBytes: Buffer.byteLength(
      messages.slice(1).map((message) => message.content).join('\n'),
      'utf8'
    )
  };
}
