import { CURRENT_SCHEMA, CoreState, ObservationRecord, RepoState, VersionSnapshot } from "./types";
import { cloneCore, emptyCore, nowTs, uid } from "./merge";

const MAX_VERSIONS = 30;

export function createRepo(core?: CoreState): RepoState {
  const base = core ?? emptyCore();
  const v0: VersionSnapshot = { id: uid("ver"), label: "初始版本", at: nowTs(), core: cloneCore(base) };
  return { ...cloneCore(base), versions: [v0], currentVersionId: v0.id };
}

/** 每次变更追加不可变快照；看板/详情/导出始终读取 currentVersionId 指向的同一版本 */
export function commit(repo: RepoState, core: CoreState, label: string): RepoState {
  const snap: VersionSnapshot = { id: uid("ver"), label, at: nowTs(), core: cloneCore(core) };
  const versions = [...repo.versions, snap].slice(-MAX_VERSIONS);
  return { ...cloneCore(core), versions, currentVersionId: snap.id };
}

export function currentCore(repo: RepoState): CoreState {
  const snap = repo.versions.find((v) => v.id === repo.currentVersionId) ?? repo.versions[0];
  return snap.core;
}

export const STATUS_LABEL: Record<ObservationRecord["status"], string> = {
  draft: "草稿",
  confirmed: "已确认",
  reconfirm: "待重新确认",
  paused: "已停住",
};

/**
 * 回滚：旧数据不删。把目标快照作为新版本追加到版本线尾部并指过去，
 * 之后的版本仍保留，可再次"恢复"回来。
 */
export function rollback(repo: RepoState, versionId: string): RepoState {
  const target = repo.versions.find((v) => v.id === versionId);
  if (!target) return repo;
  const snap: VersionSnapshot = {
    id: uid("ver"),
    label: `回滚至「${target.label}」`,
    at: nowTs(),
    core: cloneCore(target.core),
  };
  const versions = [...repo.versions, snap].slice(-MAX_VERSIONS);
  return { ...cloneCore(snap.core), versions, currentVersionId: snap.id };
}

/** 导出严格对齐当前版本：看板/详情/导出同版同源 */
export function exportSnapshot(core: CoreState): string {
  const payload = {
    format: "hxwl-observation",
    schemaVersion: CURRENT_SCHEMA,
    exportedAt: new Date(nowTs()).toISOString(),
    samples: Object.values(core.samples),
    batches: Object.values(core.batches),
    records: Object.values(core.records).map((r) => ({
      slideCode: r.slideCode,
      sampleCode: r.sampleCode,
      batchCode: r.batchCode,
      status: STATUS_LABEL[r.status],
      fields: r.fields.map((f) => ({
        magnification: f.magnification,
        structure: f.structure,
        description: f.description,
        observedBy: f.sources.map((s) => s.teacher),
        repeatCount: f.sources.length,
        blockedAlternates: f.alternates.map((a) => ({
          description: a.description,
          teacher: a.source.teacher,
          device: a.source.deviceId,
        })),
      })),
      reviews: r.reviews.map((rv) => ({
        teacher: rv.teacher,
        state: rv.state === "accepted" ? "通过" : "保留草稿",
        basis: rv.basis,
        submittedAt: new Date(rv.submittedAt).toISOString(),
      })),
      audit: r.notes.map((n) => ({ at: new Date(n.at).toISOString(), text: n.text })),
    })),
    anomalies: core.anomalies.map((a) => ({
      kind: a.kind,
      message: a.message,
      resolved: a.resolved,
      resolution: a.resolution ?? null,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
