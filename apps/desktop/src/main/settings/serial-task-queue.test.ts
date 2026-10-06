import { describe, expect, it } from 'vitest';
import { SerialTaskQueue } from './serial-task-queue';

describe('SerialTaskQueue', () => {
  it('runs tasks in order and continues after a failed task', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let finishFirst!: () => void;
    const first = queue.run(async () => {
      events.push('first-start');
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push('first-end');
    });
    const second = queue.run(async () => {
      events.push('second');
      throw new Error('write failed');
    });
    const third = queue.run(async () => {
      events.push('third');
      return 'complete';
    });

    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    finishFirst();
    await first;
    await expect(second).rejects.toThrow('write failed');
    await expect(third).resolves.toBe('complete');
    expect(events).toEqual(['first-start', 'first-end', 'second', 'third']);
  });
});
