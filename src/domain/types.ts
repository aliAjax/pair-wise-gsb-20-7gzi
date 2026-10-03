export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = "hxwl06.store.v2";
export const LEGACY_STORAGE_KEY = "hxwl06.store.v1";

export type ObsStatus = "draft" | "paused" | "confirmed" | "reconfirm";
export type Origin = "lab" | "offline";
export type BatchStatus = "active" | "invalid";

export interface StainBatch {
  id: string;
  stain: string;
  lotNo: string;
  status: BatchStatus;
  invalidatedAt: string | null;
}

export interface Sample {
  id: string;
  name: string;
  type: string;
}

export interface Slide {
  id: string;
  sampleId: string;
  label: string;
}

export interface FieldView {
  id: string;
  magnification: string;
  structure: string;
  note: string;
  createdBy: string;
  createdAt: string;
  origin: Origin;
}

export interface Review {
  reviewer: string;
  rationale: string;
  at: string;
}

/** 观察记录：同一玻片 + 同一染色批次只存在一条 */
export interface Observation {
  id: string;
  slideId: string;
  batchId: string;
  status: ObsStatus;
  note: string;
  views: FieldView[];
  review: Review | null;
  /** 修订号：复核并发控制的依据，每次内容变更 +1 */
  revision: number;
  origin: Origin;
  createdAt: string;
  updatedAt: string;
}

export interface ViewInput {
  magnification: string;
  structure: string;
  note: string;
}

export interface RegistrationPayload {
  sampleName: string;
  sampleType: string;
  slideLabel: string;
  batch: { stain: string; lotNo: string };
  note: string;
  views: ViewInput[];
  createdBy: string;
}

/** 断网时登记的待合并条目 */
export interface OutboxEntry {
  id: string;
  queuedAt: string;
  queuedBy: string;
  payload: RegistrationPayload;
  lastError: string | null;
}

export type EventKind =
  | "net"
  | "queued"
  | "inserted"
  | "view-merged"
  | "view-duplicate"
  | "kept-existing"
  | "batch"
  | "sample"
  | "slide"
  | "merge-start"
  | "merge-done"
  | "error"
  | "rollback"
  | "invalidate"
  | "restore"
  | "review-passed"
  | "review-conflict"
  | "draft-resolved"
  | "draft-discarded"
  | "compat"
  | "reset";

export interface MergeEvent {
  id: string;
  at: string;
  kind: EventKind;
  message: string;
}

/** 复核冲突时被保留的草稿与依据 */
export interface ReviewDraft {
  id: string;
  obsId: string;
  reviewer: string;
  rationale: string;
  keptAt: string;
  reason: string;
}

/** 可回滚的数据切片（合并前快照） */
export interface SnapshotData {
  samples: Sample[];
  slides: Slide[];
  batches: StainBatch[];
  observations: Observation[];
  outbox: OutboxEntry[];
}

export interface Snapshot {
  id: string;
  at: string;
  label: string;
  data: SnapshotData;
}

export interface AppState extends SnapshotData {
  schemaVersion: number;
  /** 全局数据修订号：看板、详情、导出共用同一版本标识 */
  dataRevision: number;
  online: boolean;
  mergeLog: MergeEvent[];
  reviewDrafts: ReviewDraft[];
  snapshots: Snapshot[];
  /** 旧版原始数据存档（保留不丢） */
  legacyArchive: unknown | null;
}

export const STATUS_LABEL: Record<ObsStatus, string> = {
  draft: "草稿",
  paused: "已暂停",
  confirmed: "已确认",
  reconfirm: "待重新确认",
};

export const ORIGIN_LABEL: Record<Origin, string> = {
  lab: "室内",
  offline: "离线合并",
};

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 视野判重指纹：同一记录内 倍数+结构 相同视为重复视野 */
export function viewFingerprint(v: { magnification: string; structure: string }): string {
  return `${v.magnification.trim()}|${v.structure.trim()}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
