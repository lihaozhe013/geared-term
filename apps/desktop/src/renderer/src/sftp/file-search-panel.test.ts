// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalEntry, SftpRemoteEntry } from '@geared-term/protocol';
import { SftpPanel } from '../SftpPanel';

const remoteEntries: SftpRemoteEntry[] = [
  {
    name: 'folder',
    path: '/remote/folder',
    longName: 'drwxr-xr-x folder',
    kind: 'directory',
    size: 0,
    modifiedAt: null
  },
  ...['notes.txt', 'report-old.txt', 'report.txt'].map((name) => ({
    name,
    path: `/remote/${name}`,
    longName: `-rw-r--r-- ${name}`,
    kind: 'file' as const,
    size: 1,
    modifiedAt: null
  }))
];

const localEntries: LocalEntry[] = [
  {
    name: 'folder',
    path: '/local/folder',
    kind: 'directory',
    size: 0,
    modifiedAt: null,
    permissions: 'rwxr-xr-x',
    guarded: false
  },
  ...['local-report.txt', 'notes.txt'].map((name) => ({
    name,
    path: `/local/${name}`,
    kind: 'file' as const,
    size: 1,
    modifiedAt: null,
    permissions: 'rw-r--r--',
    guarded: false
  }))
];

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('file search panel interactions', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await settle();
      });
    }
    host?.remove();
    root = undefined;
    host = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  it('filters each pane independently and excludes hidden selections from actions', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const downloadSftp = vi.fn(async () => ({ accepted: true }));
    const downloadPathsSftp = vi.fn(async () => []);
    const uploadPathsSftp = vi.fn(async () => []);
    const sftpDelete = vi.fn(async () => undefined);
    const deleteLocalPaths = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = {
      listSftp: vi.fn(async ({ directory }: { directory: string }) => ({
        directory: directory === '.' ? '/remote' : directory,
        entries: directory.endsWith('/folder')
          ? [
              {
                name: 'child.txt',
                path: `${directory}/child.txt`,
                longName: '-rw-r--r-- child.txt',
                kind: 'file' as const,
                size: 1,
                modifiedAt: null
              }
            ]
          : remoteEntries
      })),
      sftpTrackedDirectory: vi.fn(async () => '/remote'),
      listSftpTransfers: vi.fn(async () => []),
      onSftpTransferEvent: vi.fn(() => () => undefined),
      onSftpEditorSaved: vi.fn(() => () => undefined),
      onSftpCd: vi.fn(() => () => undefined),
      listLocalFiles: vi.fn(async (directory: string | null) =>
        directory === '/local/folder'
          ? [
              {
                name: 'child-local.txt',
                path: '/local/folder/child-local.txt',
                kind: 'file' as const,
                size: 1,
                modifiedAt: null,
                permissions: 'rw-r--r--',
                guarded: false
              }
            ]
          : localEntries
      ),
      sftpSendCd: vi.fn(async () => undefined),
      sftpDelete,
      deleteLocalPaths,
      downloadSftp,
      downloadPathsSftp,
      uploadPathsSftp
    };
    Object.defineProperty(window, 'geared', { configurable: true, value: api });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        createElement(SftpPanel, {
          sessionId: 'ssh-1',
          language: 'en-US',
          remoteFileCommands: [],
          alternateScreen: false,
          probeDirectory: async () => '/remote',
          onClose: vi.fn()
        })
      );
      await settle();
    });

    const remotePane = host.querySelector<HTMLElement>('.sftp-pane[aria-label="Remote files"]');
    const localPane = host.querySelector<HTMLElement>('.local-file-pane');
    expect(remotePane).not.toBeNull();
    expect(localPane).not.toBeNull();

    const remoteSearch = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search remote files"]'
    );
    const localSearch = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search local files"]'
    );
    expect(remoteSearch).not.toBeNull();
    expect(localSearch).not.toBeNull();

    await act(async () => {
      setInputValue(remoteSearch!, 'rptt');
      await settle();
    });
    expect(
      [...remotePane!.querySelectorAll('.sftp-entry-label')].map((label) => label.textContent)
    ).toEqual(['report.txt', 'report-old.txt']);
    expect(
      [...localPane!.querySelectorAll('.sftp-entry-label')].map((label) => label.textContent)
    ).toContain('notes.txt');

    await act(async () => {
      remotePane!.querySelector<HTMLButtonElement>('.sftp-entry')?.click();
      setInputValue(remoteSearch!, 'notes');
      await settle();
    });
    expect(remotePane!.querySelector('.sftp-entry[data-selected="true"]')).toBeNull();
    await act(async () => {
      remotePane!
        .querySelector<HTMLButtonElement>('.sftp-actions button[aria-label="Download"]')
        ?.click();
      await settle();
    });
    expect(downloadSftp).not.toHaveBeenCalled();
    expect(downloadPathsSftp).not.toHaveBeenCalled();

    await act(async () => {
      remotePane!
        .querySelector<HTMLButtonElement>('.sftp-entry')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
      await settle();
      [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === 'Delete')
        ?.click();
      await settle();
    });
    expect(sftpDelete).toHaveBeenCalledWith({ sessionId: 'ssh-1', paths: ['/remote/notes.txt'] });

    await act(async () => {
      [...localPane!.querySelectorAll<HTMLButtonElement>('.sftp-entry')]
        .find((entry) => entry.textContent?.includes('local-report.txt'))
        ?.click();
      setInputValue(localSearch!, 'notes');
      await settle();
    });
    expect(localPane!.querySelector('.sftp-entry[data-selected="true"]')).toBeNull();
    expect(
      localPane!.querySelector<HTMLButtonElement>('.sftp-actions button[aria-label="Upload"]')
        ?.disabled
    ).toBe(true);
    expect(uploadPathsSftp).not.toHaveBeenCalled();

    await act(async () => {
      localPane!
        .querySelector<HTMLButtonElement>('.sftp-entry')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
      await settle();
      [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === 'Delete')
        ?.click();
      await settle();
    });
    expect(deleteLocalPaths).toHaveBeenCalledWith(['/local/notes.txt']);

    await act(async () => {
      setInputValue(remoteSearch!, 'no-match');
      await settle();
    });
    expect(remotePane!.textContent).toContain('No matching files in this directory.');
    expect(remotePane!.textContent).toContain('0 of 4 items');

    await act(async () => {
      remotePane!
        .querySelector<HTMLButtonElement>('.sftp-pane-header button[aria-label="Refresh"]')
        ?.click();
      await settle();
    });
    expect(remoteSearch!.value).toBe('no-match');

    await act(async () => {
      remoteSearch!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
    });
    expect(remoteSearch!.value).toBe('');

    await act(async () => {
      setInputValue(remoteSearch!, 'folder');
      await settle();
      remotePane!
        .querySelector<HTMLButtonElement>('.sftp-entry')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
    });
    expect(remoteSearch!.value).toBe('');
    expect(remotePane!.textContent).toContain('child.txt');

    await act(async () => {
      setInputValue(localSearch!, 'folder');
      await settle();
      localPane!
        .querySelector<HTMLButtonElement>('.sftp-entry')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
    });
    expect(localSearch!.value).toBe('');
    expect(localPane!.textContent).toContain('child-local.txt');
  });
});
