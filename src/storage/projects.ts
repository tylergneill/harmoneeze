import { openDB, type IDBPDatabase } from 'idb';
import type { MixState, Project, Score } from '../core/types';
import { initialMixState } from '../core/mixer';

/**
 * Local-first project storage (execution doc §7).
 *
 * Everything lives in the browser. No server means no deployment story and no
 * question about uploaded sheet music sitting on someone else's disk.
 */

const DB_NAME = 'harmoneeze';
const DB_VERSION = 1;
const STORE = 'projects';

/** What actually goes to disk: the source file plus everything derived. */
interface StoredProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sourceFileName: string | null;
  sourceBytes: ArrayBuffer | null;
  score: Score;
  mixState: MixState;
  notes: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
  return dbPromise;
}

function toProject(stored: StoredProject): Project {
  return {
    id: stored.id,
    title: stored.title,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    sourceFile:
      stored.sourceBytes === null
        ? null
        : { name: stored.sourceFileName ?? 'score', bytes: stored.sourceBytes },
    score: stored.score,
    mixState: stored.mixState,
    notes: stored.notes,
  };
}

function toStored(project: Project): StoredProject {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceFileName: project.sourceFile?.name ?? null,
    sourceBytes: project.sourceFile?.bytes ?? null,
    score: project.score,
    mixState: project.mixState,
    notes: project.notes,
  };
}

export function createProject(
  score: Score,
  sourceFile: { name: string; bytes: ArrayBuffer } | null,
): Project {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: score.title,
    createdAt: now,
    updatedAt: now,
    sourceFile,
    score,
    mixState: initialMixState(score),
    notes: '',
  };
}

/** Projects, most recently opened first (§6.1). */
export async function listProjects(): Promise<Project[]> {
  const all = (await (await db()).getAll(STORE)) as StoredProject[];
  return all.map(toProject).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  const stored = (await (await db()).get(STORE, id)) as StoredProject | undefined;
  return stored === undefined ? null : toProject(stored);
}

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put(STORE, toStored({ ...project, updatedAt: Date.now() }));
}

export async function deleteProject(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

export async function renameProject(id: string, title: string): Promise<void> {
  const project = await loadProject(id);
  if (project === null) return;
  await saveProject({ ...project, title });
}
