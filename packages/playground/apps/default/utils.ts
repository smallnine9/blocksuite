import { __unstableSchemas, AffineSchemas } from '@blocksuite/blocks/models';
import { EditorContainer } from '@blocksuite/editor';
import {
  configDebugLog,
  disableDebuglog,
  enableDebugLog,
} from '@blocksuite/global/debug';
import type { BlobStorage, Page } from '@blocksuite/store';
import type { Y } from '@blocksuite/store';
import {
  assertExists,
  createIndexeddbStorage,
  Generator,
  Utils,
  Workspace,
  type WorkspaceOptions,
} from '@blocksuite/store';
import { fileOpen } from 'browser-fs-access';

import { INDEXED_DB_NAME } from './providers/indexeddb-provider.js';

export const params = new URLSearchParams(location.search);
export const defaultMode = params.get('mode') === 'page' ? 'page' : 'edgeless';

const featureArgs = (params.get('features') ?? '').split(',');

export function getOptions(
  fn: (params: URLSearchParams) => Record<string, string | number>
) {
  return fn(params);
}

declare global {
  // eslint-disable-next-line no-var
  var targetPageId: string | undefined;
  // eslint-disable-next-line no-var
  var debugWorkspace: Workspace | undefined;
}

Object.defineProperty(globalThis, 'openFromFile', {
  value: async function importFromFile(pageId?: string) {
    const file = await fileOpen({
      extensions: ['.ydoc'],
    });
    const buffer = await file.arrayBuffer();
    if (pageId) {
      globalThis.targetPageId = pageId;
    }
    Workspace.Y.applyUpdate(window.workspace.doc, new Uint8Array(buffer));
  },
});

Object.defineProperty(globalThis, 'rebuildPageTree', {
  value: async function rebuildPageTree(doc: Y.Doc, pages: string[]) {
    const pageTree = doc
      .getMap<Y.Array<Y.Map<unknown>>>('space:meta')
      .get('pages');
    if (pageTree) {
      const pageIds = pageTree.map(p => p.get('id') as string).filter(v => v);
      for (const page of pages) {
        if (!pageIds.includes(page)) {
          const map = new Workspace.Y.Map([
            ['id', page],
            ['title', ''],
            ['createDate', +new Date()],
            ['subpageIds', []],
          ]);
          pageTree.push([map]);
        }
      }
    }
  },
});

Object.defineProperty(globalThis, 'debugFromFile', {
  value: async function debuggerFromFile() {
    const file = await fileOpen({
      extensions: ['.ydoc'],
    });
    const buffer = await file.arrayBuffer();
    const workspace = new Workspace({
      id: 'temporary',
    })
      .register(AffineSchemas)
      .register(__unstableSchemas);
    Workspace.Y.applyUpdate(workspace.doc, new Uint8Array(buffer));
    globalThis.debugWorkspace = workspace;
  },
});

export const isBase64 =
  /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/;

export function initDebugConfig() {
  Object.defineProperty(globalThis, 'enableDebugLog', {
    value: enableDebugLog,
  });
  Object.defineProperty(globalThis, 'disableDebugLog', {
    value: disableDebuglog,
  });
  Object.defineProperty(globalThis, 'configDebugLog', {
    value: configDebugLog,
  });
}

async function initWithMarkdownContent(
  workspace: Workspace,
  url: URL,
  pageId: string
) {
  const { edgelessEmpty: emptyInit } = await import('./presets/index.js');

  emptyInit(workspace, pageId);
  const page = workspace.getPage(pageId);
  assertExists(page);
  assertExists(page.root);
  const content = await fetch(url).then(res => res.text());
  const contentParser = new window.ContentParser(page);
  return contentParser.importMarkdown(content, page.root.id);
}

export async function tryInitExternalContent(
  workspace: Workspace,
  initParam: string,
  pageId: string
) {
  if (isValidUrl(initParam)) {
    const url = new URL(initParam);
    await initWithMarkdownContent(workspace, url, pageId);
  } else if (isBase64.test(initParam)) {
    Utils.applyYjsUpdateV2(workspace, initParam);
  }
}

/**
 * Provider configuration is specified by `?providers=broadcast` or `?providers=indexeddb,broadcast` in URL params.
 * We use BroadcastChannelProvider by default if the `providers` param is missing.
 */
export function createWorkspaceOptions(): WorkspaceOptions {
  const blobStorages: ((id: string) => BlobStorage)[] = [
    createIndexeddbStorage,
  ];
  const idGenerator: Generator = Generator.AutoIncrement; // works only in single user mode

  return {
    id: 'quickEdgeless',
    providerCreators: [],
    idGenerator,
    blobStorages,
    defaultFlags: {
      enable_toggle_block: featureArgs.includes('toggle'),
      enable_set_remote_flag: true,
      enable_drag_handle: true,
      enable_block_hub: true,
      enable_database: true,
      enable_edgeless_toolbar: true,
      enable_linked_page: true,
      enable_bookmark_operation: true,
      enable_note_index: true,
      readonly: {
        'space:page0': false,
      },
    },
  };
}

export function isValidUrl(urlLike: string) {
  let url;
  try {
    url = new URL(urlLike);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export async function testIDBExistence() {
  let databaseExists = false;
  try {
    databaseExists =
      (await indexedDB.databases()).find(db => db.name === INDEXED_DB_NAME) !==
      undefined;
  } catch (e) {
    const request = indexedDB.open(INDEXED_DB_NAME);
    databaseExists = await new Promise(resolve => {
      const unlisten = () => {
        request.removeEventListener('success', success);
        request.removeEventListener('error', error);
      };
      const success = () => {
        resolve(true);
        unlisten();
      };
      const error = () => {
        resolve(false);
        unlisten();
      };
      request.addEventListener('success', success);
      request.addEventListener('error', error);
    });
  }
  return databaseExists;
}

export const createEditor = (page: Page, element: HTMLElement) => {
  const editor = new EditorContainer();
  editor.page = page;
  editor.slots.pageLinkClicked.on(({ pageId }) => {
    const target = page.workspace.getPage(pageId);
    if (!target) {
      throw new Error(`Failed to jump to page ${pageId}`);
    }
    editor.page = target;
  });

  element.append(editor);

  editor.createBlockHub().then(blockHub => {
    document.body.appendChild(blockHub);
  });
  return editor;
};
