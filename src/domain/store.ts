import { useSyncExternalStore } from "react";
import { CoreState, RepoState, SyncPack } from "./types";
import { commit, createRepo, currentCore, rollback } from "./versions";
import { mergePack, recordId, uid, nowTs } from "./merge";
import {
  invalidateBatch,
  recoverAnomaly,
  reconfirm,
  restoreBatch,
  resumePaused,
  submitReview,
  dismissAnomaly,
  ReviewInput,
} from "./lifecycle";
import { seedIndoor } from "./seed";

const STORAGE_KEY = "hxwl-06-repo-v1";
const QUEUE_KEY = "hxwl-06-queue-v1";

interface QueuedPack {
  pack: SyncPack;
  createdAt: number;
}

export interface Toast {
  id: string;
  kind: "ok" | "err";
  text: string;
}

export interface Store {
  repo: RepoState;
  online: boolean;
  queue: QueuedPack[];
  toasts: Toast[];
}

let state: Store = load();
const listeners = new Set<() => void>();

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const queueRaw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const repo = JSON.parse(raw) as RepoState;
      const queue = queueRaw ? (JSON.parse(queueRaw) as QueuedPack[]) : [];
      return { repo, online: true, queue, toasts: [] };
    }
  } catch {
    // 存储损坏则回退种子
  }
  return { repo: createRepo(seedIndoor()), online: true, queue: [], toasts: [] };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.repo));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
  } catch {
    // 容量受限时忽略持久化，内存中仍可演示
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): Store {
  return state;
}

export function useStore(): Store {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCore(): CoreState {
  return currentCore(useStore().repo);
}

function toast(kind: Toast["kind"], text: string) {
  const t: Toast = { id: uid("tst"), kind, text };
  state = { ...state, toasts: [...state.toasts, t] };
  emit();
  setTimeout(() => {
    state = { ...state, toasts: state.toasts.filter((x) => x.id !== t.id) };
    emit();
  }, 4200);
}

function applyCore(core: CoreState, label: string, okMessage?: string) {
  state = { ...state, repo: commit(state.repo, core, label) };
  emit();
  if (okMessage) toast("ok", okMessage);
}

export const actions = {
  setOnline(online: boolean) {
    state = { ...state, online };
    emit();
    toast(online ? "ok" : "err", online ? "网络已恢复" : "已进入断网模式，登记进入本地队列");
  },

  resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(QUEUE_KEY);
    state = { repo: createRepo(seedIndoor()), online: true, queue: [], toasts: [] };
    emit();
    toast("ok", "已重置为演示初始数据");
  },

  /** 教师登记（断网时入队，联网时直接合并） */
  register(params: {
    teacher: string;
    deviceId: string;
    sampleCode: string;
    sampleName: string;
    category: string;
    slideCode: string;
    batchCode: string;
    method: string;
    fields: { magnification: string; structure: string; description: string }[];
    status: "draft" | "confirmed";
  }) {
    const t = nowTs();
    const pack: SyncPack = {
      packId: uid("pk"),
      deviceId: params.deviceId || "unknown-device",
      teacher: params.teacher || "未署名教师",
      schemaVersion: 3,
      packedAt: t,
      ops: [
        { type: "sample", opId: uid("op"), code: params.sampleCode, name: params.sampleName, category: params.category, createdAt: t },
        { type: "batch", opId: uid("op"), code: params.batchCode, method: params.method, createdAt: t },
        {
          type: "observation",
          opId: uid("op"),
          sampleCode: params.sampleCode,
          slideCode: params.slideCode,
          batchCode: params.batchCode,
          fields: params.fields,
          status: params.status,
          observedAt: t,
        },
      ],
    };

    if (!state.online) {
      state = { ...state, queue: [...state.queue, { pack, createdAt: t }] };
      emit();
      toast("ok", `断网登记已入本地队列（玻片 ${params.slideCode} / 批次 ${params.batchCode}）`);
      return;
    }

    const { core, report } = mergePack(currentCore(state.repo), pack);
    const merged = report.merged[0];
    const blocked = merged?.detail.blockedWrites.length ?? 0;
    state = { ...state, repo: commit(state.repo, core, `${params.teacher} 登记 ${params.slideCode}/${params.batchCode}`) };
    emit();
    if (report.anomalyIds.length) {
      toast("err", `合并异常 ${report.anomalyIds.length} 条，已隔离待恢复；其余内容正常合并`);
    } else if (blocked) {
      toast("ok", `已并入同一条记录：${merged!.detail.added} 个新视野，${blocked} 处后到内容保留未覆盖`);
    } else {
      toast("ok", `已合并：${merged ? `${merged.detail.added} 个新视野并入一条记录` : "无新增内容"}`);
    }
  },

  /** 网络恢复：队列按登记顺序依次与室内记录合并 */
  flushQueue() {
    if (!state.queue.length) {
      toast("ok", "本地队列为空");
      return;
    }
    let core = currentCore(state.repo);
    let anomalies = 0;
    const processed: string[] = [];
    for (const item of state.queue) {
      const r = mergePack(core, item.pack);
      core = r.core;
      anomalies += r.report.anomalyIds.length;
      processed.push(item.pack.packId);
    }
    state = {
      ...state,
      repo: commit(state.repo, core, `网络恢复：合并 ${state.queue.length} 个离线包`),
      queue: [],
    };
    emit();
    toast(anomalies ? "err" : "ok", `队列已合并 ${processed.length} 包${anomalies ? `，产生 ${anomalies} 条异常待处理` : ""}`);
  },

  enqueuePack(pack: SyncPack, label: string) {
    if (!state.online) {
      state = { ...state, queue: [...state.queue, { pack, createdAt: nowTs() }] };
      emit();
      toast("ok", `${label} 已入离线队列，等待网络恢复`);
    } else {
      const { core } = mergePack(currentCore(state.repo), pack);
      state = { ...state, repo: commit(state.repo, core, label) };
      emit();
      toast("ok", `${label} 已合并`);
    }
  },

  invalidateBatch(code: string, reason: string) {
    const r = invalidateBatch(currentCore(state.repo), code, reason);
    if (r.ok) applyCore(r.core, `染色批次 ${code} 失效`, r.message);
    else toast("err", r.message);
  },

  restoreBatch(code: string) {
    const r = restoreBatch(currentCore(state.repo), code);
    if (r.ok) applyCore(r.core, `染色批次 ${code} 恢复有效`, r.message);
    else toast("err", r.message);
  },

  reconfirm(slideCode: string, batchCode: string, teacher: string) {
    const r = reconfirm(currentCore(state.repo), slideCode, batchCode, teacher);
    if (r.ok) applyCore(r.core, `${teacher} 重新确认 ${slideCode}`, r.message);
    else toast("err", r.message);
  },

  resume(slideCode: string, batchCode: string) {
    const r = resumePaused(currentCore(state.repo), slideCode, batchCode);
    if (r.ok) applyCore(r.core, `${slideCode}/${batchCode} 草稿恢复`, r.message);
    else toast("err", r.message);
  },

  submitReview(slideCode: string, batchCode: string, rv: Omit<ReviewInput, "submittedAt">) {
    const rec = currentCore(state.repo).records[recordId(slideCode, batchCode)];
    const r = submitReview(currentCore(state.repo), slideCode, batchCode, { ...rv, submittedAt: nowTs() });
    if (r.ok) {
      applyCore(r.core, `${rv.teacher} 复核通过 ${slideCode}`, r.message);
    } else {
      // 后到者：仍产生版本（草稿留痕），但提示未通过
      if (r.reviewId) {
        state = { ...state, repo: commit(state.repo, r.core, `${rv.teacher} 复核被并发抢先，保留草稿`) };
        emit();
      }
      toast("err", r.message);
    }
    void rec;
  },

  recoverAnomaly(id: string, force: boolean) {
    const r = recoverAnomaly(currentCore(state.repo), id, { force });
    if (r.ok) applyCore(r.core, force ? "强制恢复合并异常" : "恢复合并异常", r.message);
    else toast("err", r.message);
  },

  dismissAnomaly(id: string) {
    const r = dismissAnomaly(currentCore(state.repo), id);
    if (r.ok) applyCore(r.core, "异常归档", r.message);
    else toast("err", r.message);
  },

  rollback(versionId: string) {
    const target = state.repo.versions.find((v) => v.id === versionId);
    if (!target) return;
    state = { ...state, repo: rollback(state.repo, versionId) };
    emit();
    toast("ok", `已回滚到「${target.label}」，之后版本仍保留`);
  },
};
