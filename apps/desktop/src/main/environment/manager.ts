import { randomUUID } from 'node:crypto';
import type {
  EnvironmentFacts,
  EnvironmentRecord,
  LocalTerminalRequest
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import type { AppStorage } from '../persistence/app-storage';
import { parseProbeOutput, probeEnvironment } from './probe';

type EnvironmentUpdate = (record: EnvironmentRecord) => void;

function wslDistribution(request: LocalTerminalRequest): string | undefined {
  if (!request.shell?.toLowerCase().endsWith('wsl.exe')) return undefined;
  return request.args.find(
    (arg, index) => request.args[index - 1] === '--distribution' || request.args[index - 1] === '-d'
  );
}

export class EnvironmentManager {
  private readonly probes = new Map<string, AbortController>();

  public constructor(
    private readonly storage: AppStorage,
    private readonly logger: Logger,
    private readonly onUpdated?: EnvironmentUpdate
  ) {}

  public onLocalReady(details: {
    sessionId: string;
    shell: string;
    cwd: string;
    environment: Record<string, string>;
    request: LocalTerminalRequest;
  }): void {
    this.cancel(details.sessionId);
    const controller = this.begin(details.sessionId);
    const distribution = wslDistribution(details.request);
    const kind = distribution ? 'wsl' : 'local';
    const targetKey = `${kind}:${details.sessionId}`;
    const legacyTargetKeys = distribution ? [`wsl:${distribution}`] : ['local'];
    this.logger.info('assistant', 'Environment probe requested', {
      kind,
      sessionId: details.sessionId
    });
    void probeEnvironment(kind, distribution, process.platform, {
      shell: details.shell,
      cwd: details.cwd,
      environment: details.environment,
      signal: controller.signal
    })
      .then((facts) => {
        this.probes.delete(details.sessionId);
        this.store(targetKey, kind, facts, legacyTargetKeys);
      })
      .catch((error) => {
        this.probes.delete(details.sessionId);
        if (error instanceof Error && error.message === 'Environment probe cancelled') return;
        this.logger.warn('assistant', 'Environment probe failed', {
          kind,
          sessionId: details.sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  public onSshReady(
    details: { sessionId: string; targetKey: string },
    execute: (signal: AbortSignal) => Promise<string>
  ): void {
    this.cancel(details.sessionId);
    const controller = this.begin(details.sessionId);
    this.logger.info('assistant', 'Environment probe requested', {
      kind: 'ssh',
      sessionId: details.sessionId
    });
    void execute(controller.signal)
      .then((output) => {
        this.probes.delete(details.sessionId);
        this.store(details.targetKey, 'ssh', parseProbeOutput(output));
      })
      .catch((error) => {
        this.probes.delete(details.sessionId);
        if (error instanceof Error && error.message === 'SSH environment probe cancelled') return;
        this.logger.warn('assistant', 'Environment probe failed', {
          kind: 'ssh',
          sessionId: details.sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  public onClosed(sessionId: string): void {
    this.cancel(sessionId);
  }

  private begin(sessionId: string): AbortController {
    const controller = new AbortController();
    this.probes.set(sessionId, controller);
    return controller;
  }

  private cancel(sessionId: string): void {
    const controller = this.probes.get(sessionId);
    if (!controller) return;
    controller.abort();
    this.probes.delete(sessionId);
  }

  private store(
    targetKey: string,
    kind: EnvironmentRecord['kind'],
    facts: EnvironmentFacts,
    legacyTargetKeys: string[] = []
  ): void {
    const existing = this.storage
      .environmentSnapshot()
      .find(
        (record) =>
          record.targetKey === targetKey ||
          (record.kind === kind && legacyTargetKeys.includes(record.targetKey))
      );
    const record: EnvironmentRecord = {
      id: existing?.id ?? randomUUID(),
      targetKey,
      kind,
      facts,
      notes: existing?.notes ?? '',
      instructions: existing?.instructions ?? '',
      attachToAi: existing?.attachToAi ?? true,
      verified: false,
      detectedAt: new Date().toISOString()
    };
    void this.storage
      .saveEnvironment(record)
      .then(() => this.onUpdated?.(record))
      .catch((error) =>
        this.logger.warn('assistant', 'Environment probe result could not be stored', {
          kind,
          error: error instanceof Error ? error.message : String(error)
        })
      );
  }
}
