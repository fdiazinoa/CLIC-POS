import type React from 'react';

type TableMapStage =
  | 'ACTION_START'
  | 'HANDLER_END'
  | 'NAVIGATION_START'
  | 'DATA_PREPARATION_START'
  | 'DATA_PREPARATION_END'
  | 'TABLE_MAP_MOUNT'
  | 'REACT_COMMIT'
  | 'TABLE_MAP_EFFECTS'
  | 'TABLE_MAP_FIRST_VISIBLE'
  | 'LOCAL_UNLOCK';

type FunctionTiming = { calls: number; totalMs: number; maxMs: number };
type ReactCommit = { component: string; phase: string; actualDurationMs: number; baseDurationMs: number; atMs: number };

export interface TableMapOpenRun {
  id: string;
  sequence: number;
  kind: 'FIRST_OPEN' | 'WARM_OPEN';
  startedAt: number;
  stages: Partial<Record<TableMapStage, number>>;
  functions: Record<string, FunctionTiming>;
  reactCommits: ReactCommit[];
  data?: { tables: number; rooms: number; tickets: number; accounts: number };
  dom?: { nodes: number; tableNodes: number; visualElements: number };
}

const runs: TableMapOpenRun[] = [];
let activeRun: TableMapOpenRun | undefined;
let sequence = 0;
let tableMapMounted = false;
let armedUntil = 0;

const now = () => performance.now();
const diagnosticsActive = () => {
  return now() < armedUntil;
};

export const beginTableMapOpen = (data: TableMapOpenRun['data']) => {
  if (!diagnosticsActive()) return undefined;
  const startedAt = now();
  activeRun = {
    id: `TABLE-MAP-OPEN-${Date.now()}-${++sequence}`,
    sequence,
    kind: tableMapMounted ? 'WARM_OPEN' : 'FIRST_OPEN',
    startedAt,
    stages: { ACTION_START: startedAt },
    functions: {},
    reactCommits: [],
    data,
  };
  runs.push(activeRun);
  if (runs.length > 100) runs.splice(0, runs.length - 100);
  performance.mark(`${activeRun.id}|ACTION_START`);
  return activeRun;
};

export const markTableMapOpenStage = (stage: TableMapStage) => {
  if (!activeRun || activeRun.stages[stage] !== undefined) return;
  const at = now();
  activeRun.stages[stage] = at;
  performance.mark(`${activeRun.id}|${stage}`);
  if (stage === 'TABLE_MAP_MOUNT') tableMapMounted = true;
};

export const recordTableMapData = (data: NonNullable<TableMapOpenRun['data']>) => {
  if (activeRun) activeRun.data = data;
};

export const measureTableMapWork = <T>(name: string, work: () => T): T => {
  if (!activeRun || activeRun.stages.TABLE_MAP_FIRST_VISIBLE !== undefined) return work();
  const startedAt = now();
  try {
    return work();
  } finally {
    const duration = now() - startedAt;
    const row = activeRun.functions[name] || { calls: 0, totalMs: 0, maxMs: 0 };
    row.calls += 1;
    row.totalMs += duration;
    row.maxMs = Math.max(row.maxMs, duration);
    activeRun.functions[name] = row;
  }
};

export const recordTableMapReactCommit: React.ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
) => {
  if (!activeRun || activeRun.stages.TABLE_MAP_FIRST_VISIBLE !== undefined) return;
  activeRun.reactCommits.push({
    component: id,
    phase,
    actualDurationMs: actualDuration,
    baseDurationMs: baseDuration,
    atMs: now(),
  });
};

export const markTableMapVisible = (root: HTMLElement | null) => {
  if (!activeRun || activeRun.stages.TABLE_MAP_FIRST_VISIBLE !== undefined) return;
  const run = activeRun;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (activeRun !== run || run.stages.TABLE_MAP_FIRST_VISIBLE !== undefined) return;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect || rect.width <= 0 || rect.height <= 0) return;
    const tableNodes = root.querySelectorAll('[data-table-map-node]').length;
    run.dom = {
      nodes: root.querySelectorAll('*').length + 1,
      tableNodes,
      visualElements: root.querySelectorAll('div,button,span,p,svg,path').length,
    };
    markTableMapOpenStage('TABLE_MAP_FIRST_VISIBLE');
    markTableMapOpenStage('LOCAL_UNLOCK');
  }));
};

export const getActiveTableMapOpen = () => activeRun;

declare global {
  interface Window {
    __TABLE_MAP_DIAGNOSTICS__?: {
      getRuns: () => TableMapOpenRun[];
      clear: () => void;
      arm: (seconds?: number) => void;
      status: () => { active: boolean; armedUntil: number };
    };
  }
}

if (typeof window !== 'undefined') {
  window.__TABLE_MAP_DIAGNOSTICS__ = {
    getRuns: () => structuredClone(runs),
    arm: (seconds = 45) => {
      armedUntil = now() + Math.min(Math.max(seconds, 1), 120) * 1000;
    },
    status: () => ({ active: diagnosticsActive(), armedUntil }),
    clear: () => {
      runs.splice(0, runs.length);
      activeRun = undefined;
      sequence = 0;
      tableMapMounted = Boolean(document.querySelector('[data-table-map-root]'));
    },
  };
}
