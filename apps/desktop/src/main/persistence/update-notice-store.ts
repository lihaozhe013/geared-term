import { join } from 'node:path';
import { z } from 'zod';
import { VersionedJsonStore } from './json-store';

const UpdateNoticeStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    dismissedCommitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/i)
      .optional()
  })
  .strict();

type UpdateNoticeState = z.infer<typeof UpdateNoticeStateSchema>;

const defaultState: UpdateNoticeState = { schemaVersion: 1 };

export class UpdateNoticeStore {
  private readonly store: VersionedJsonStore<UpdateNoticeState>;
  private state = defaultState;

  public constructor(rootDirectory: string) {
    this.store = new VersionedJsonStore(
      join(rootDirectory, 'update-notice.json'),
      UpdateNoticeStateSchema,
      defaultState
    );
  }

  public async load(): Promise<void> {
    this.state = (await this.store.load()).value;
  }

  public dismissedCommitSha(): string | undefined {
    return this.state.dismissedCommitSha;
  }

  public async dismiss(commitSha: string): Promise<void> {
    const next = UpdateNoticeStateSchema.parse({ schemaVersion: 1, dismissedCommitSha: commitSha });
    await this.store.save(next);
    this.state = next;
  }
}
