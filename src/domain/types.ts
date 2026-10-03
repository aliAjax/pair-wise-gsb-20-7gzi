// 显微观察离线登记/合并领域模型

export type ID = string;

export const CURRENT_SCHEMA = 3;

export type Origin = "indoor" | "offline";

export interface Sample {
  id: ID;
  code: string; // 样本编号（自然键）
  name: string;
  category: string;
  createdAt: number;
  origin: Origin;
}

export type BatchStatus = "active" | "invalid";

export interface StainBatch {
  id: ID;
  code: string; // 染色批次号（自然键）
  method: string; // 染色方式
  status: BatchStatus;
  invalidAt?: number;
  invalidReason?: string;
  createdAt: number;
  origin: Origin;
}

export interface FieldProvenance {
  deviceId: string;
  teacher: string;
  clientOpId: ID;
  observedAt: number;
  arrivedAt: number;
}

/** 被拦截的后到内容：不覆盖原值，但原文与依据保留 */
export interface BlockedAlternate {
  description: string;
  source: FieldProvenance;
}

export interface ObservationField {
  key: string; // 放大倍数 + 观察结构 组成的视野自然键
  magnification: string;
  structure: string;
  description: string; // 首次写入值，后到内容不得覆盖
  fieldId: ID;
  sources: FieldProvenance[]; // 同一视野的多次重复登记
  alternates: BlockedAlternate[];
}

export type ObservationStatus = "draft" | "confirmed" | "reconfirm" | "paused";

export interface Review {
  id: ID;
  teacher: string;
  verdict: "approve";
  basis: string; // 复核依据
  submittedAt: number;
  clientOpId?: ID;
  accepted: boolean; // 同时提交时只有一份 accepted
  state: "accepted" | "draft"; // 后到者保留为草稿
  rejectReason?: string;
  recordVersion?: number;
}

export interface AuditNote {
  at: number;
  text: string;
}

export interface ObservationRecord {
  id: ID;
  sampleId: ID;
  sampleCode: string;
  slideCode: string; // 玻片编号
  batchId: ID;
  batchCode: string; // 玻片 + 批次 = 观察记录自然键
  status: ObservationStatus;
  fields: ObservationField[];
  reviews: Review[];
  approvedBy?: string;
  approvedAt?: number;
  lastReconfirmedAt?: number;
  version: number; // 乐观锁/CAS 版本号
  createdAt: number;
  updatedAt: number;
  notes: AuditNote[];
  compat?: boolean; // 旧版本数据兼容迁入标记
}

export interface FieldDraft {
  magnification: string;
  structure: string;
  description: string;
}

export type SyncOp =
  | { type: "sample"; opId: ID; code: string; name: string; category: string; createdAt: number }
  | { type: "batch"; opId: ID; code: string; method: string; createdAt: number }
  | {
      type: "observation";
      opId: ID;
      sampleCode: string;
      slideCode: string;
      batchCode: string;
      fields: FieldDraft[];
      status: "draft" | "confirmed";
      observedAt: number;
    };

export interface SyncPack {
  packId: ID;
  deviceId: string;
  teacher: string;
  schemaVersion: number;
  packedAt: number;
  ops: SyncOp[];
}

export type AnomalyKind =
  | "unknown-schema" // 高版本数据，暂不认识
  | "conflicting-entity" // 同批次号但染色方式不一致等
  | "unresolved-ref" // 引用的样本/批次不存在
  | "malformed"; // 数据结构损坏

export interface MergeAnomaly {
  id: ID;
  kind: AnomalyKind;
  message: string;
  packId: ID;
  pack: SyncPack; // 原始包完整保留，可恢复
  opId?: ID;
  createdAt: number;
  resolved: boolean;
  resolution?: string;
}

/** 可持久化的核心状态（版本快照保存的就是它） */
export interface CoreState {
  schemaVersion: number;
  samples: Record<ID, Sample>;
  batches: Record<ID, StainBatch>;
  records: Record<ID, ObservationRecord>;
  appliedOpIds: ID[];
  anomalies: MergeAnomaly[];
}

export interface VersionSnapshot {
  id: ID;
  label: string;
  at: number;
  core: CoreState;
}

export interface RepoState extends CoreState {
  versions: VersionSnapshot[];
  currentVersionId: ID;
}

export interface FieldMergeDetail {
  existing: number;
  added: number;
  blockedWrites: string[];
}

export interface MergeReport {
  applied: string[];
  skipped: string[];
  merged: { recordId: ID; slideCode: string; batchCode: string; detail: FieldMergeDetail }[];
  anomalyIds: string[];
  quarantined: boolean;
}
