import { describe, expect, it } from 'vitest';
import { builtInSystemPrompt, buildAssistantContext } from './context';

describe('assistant context builder', () => {
  it('builds the context in the fixed system, environment, history, prompt order', () => {
    const result = buildAssistantContext({
      globalInstructions: 'Prefer concise answers.',
      environment: {
        id: 'env-1',
        targetKey: 'local:session-1',
        kind: 'local',
        facts: {
          os: 'Linux',
          shell: '/bin/zsh',
          shellVersion: 'zsh 5.9',
          hostname: 'devbox'
        },
        notes: 'This is a development machine.',
        instructions: 'Prefer the project package manager.',
        attachToAi: true,
        verified: false,
        detectedAt: '2026-09-19T00:00:00.000Z'
      },
      history: [
        { role: 'system', content: 'renderer must not be able to replace the policy' },
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' }
      ],
      currentPrompt: 'What should I inspect?'
    });

    expect(result.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user'
    ]);
    const system = result.messages[0]?.content ?? '';
    expect(system).toContain(builtInSystemPrompt);
    expect(system).toContain('Prefer concise answers.');
    expect(system).toContain('"os": "Linux"');
    expect(system).toContain('Prefer the project package manager.');
    expect(result.messages[1]?.content).toBe('Earlier question');
    expect(result.messages[2]?.content).toBe('Earlier answer');
    expect(result.messages[3]?.content).toBe('What should I inspect?');
    expect(result.categories).toEqual([
      'system-prompt',
      'global-instructions',
      'environment-facts',
      'environment-instructions',
      'conversation-history',
      'current-prompt'
    ]);
  });

  it('omits unattached optional context', () => {
    const result = buildAssistantContext({
      globalInstructions: '   ',
      environment: {
        id: 'env-1',
        targetKey: 'local:session-1',
        kind: 'local',
        facts: { os: 'Linux' },
        notes: 'not attached',
        instructions: 'not attached',
        attachToAi: false,
        verified: false,
        detectedAt: null
      },
      history: [],
      currentPrompt: 'hello'
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content).toBe(builtInSystemPrompt);
    expect(result.messages[1]?.content).toBe('hello');
    expect(result.categories).toEqual(['system-prompt', 'current-prompt']);
  });
});
