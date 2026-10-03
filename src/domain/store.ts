import {
  AppState,
  EventKind,
  FieldView,
  MergeEvent,
  Observation,
  Origin,
  OutboxEntry,
  RegistrationPayload,
  ReviewDraft,
  Snapshot,
  SnapshotData,
  LEGACY_STORAGE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  nowIso,
  uid,
  viewFingerprint,
} from "./types";
import { LegacyPayload, migrateLegacyV1 } from "./migrate";

/** 内置旧版种子数据（等价于 v1 时代导出的记录） */
const LEGACY_SEED: LegacyPayload = {
  records: [
    ["洋葱表皮", "植物组织", "碘液", "400x", "细胞壁清晰，细胞核可见"],
    ["人血涂片", "血液涂片", "瑞氏染色", "1000x", "红细胞分布均匀"],
    ["草履虫", "微生物", "活体观察", "200x", "纤毛运动明显"],
  ],
};

function ev(kind: EventKind, message: string): MergeEvent {
  return { id: uid("ev"), at: nowIso(), kind, message };
}

function seedState(): AppState {
  const migrated = migrateLegacyV1(LEGACY_SEED);
  return {
    schemaVersion: SCHEMA_VERSION,
    dataRevision: 1,
    online: true,
    ...migrated,
    outbox: [],
    mergeLog: [ev("compat", "已兼容旧版 v1 数据：迁移 3 条历史记录，原始数据保留在档案中")],
    reviewDrafts: [],
    snapshots: [],
    legacyArchive: LEGACY_SEED,
  };
}

/** 兼容打开：缺失字段用种子兜底，版本号对齐当前 */
function normalize(parsed: Partial<AppState>): AppState {
  const seed = seedState();
  return {
    ...seed,
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    dataRevision: typeof parsed.dataRevision === "number" ? parsed.dataRevision : seed.dataRevision,
    samples: Array.isArray(parsed.samples) ? parsed.samples : seed.samples,
    slides: Array.isArray(parsed.slides) ? parsed.slides : seed.slides,
    batches: Array.isArray(parsed.batches) ? parsed.batches : seed.batches,
    observations: Array.isArray(parsed.observations) ? parsed.observations : seed.observations,
    outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
    mergeLog: Array.isArray(parsed.mergeLog) ? parsed.mergeLog : seed.mergeLog,
    reviewDrafts: Array.isArray(parsed.reviewDrafts) ? parsed.reviewDrafts : [],
    snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
  };
}

function loadState(): AppState {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY);
    if (rawV2) return normalize(JSON.parse(rawV2) as Partial<AppState>);
    const rawV1 = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawV1) {
      const legacy = JSON.parse(rawV1) as LegacyPayload;
      const migrated = migrateLegacyV1(legacy);
      return normalize({
        ...seedState(),
        ...migrated,
        legacyArchive: legacy,
        mergeLog: [
          ev("compat", `检测到旧版 v1 数据：迁移 ${legacy.records.length} 条历史记录，原始数据已保留`),
        ],
      });
    }
  } catch {
    // 存储不可用时退回种子数据
  }
  return seedState();
}

let state: AppState = loadState();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 忽略写入失败（如隐私模式）
  }
}

function commit(next: AppState, events: MergeEvent[], bumpRevision = true) {
  state = {
    ...next,
    dataRevision: bumpRevision ? next.dataRevision + 1 : next.dataRevision,
    mergeLog: [...events, ...next.mergeLog].slice(0, 200),
  };
  persist();
  listeners.forEach((fn) => fn());
}

function snapshotData(s: AppState): SnapshotData {
  return {
    samples: s.samples,
    slides: s.slides,
    batches: s.batches,
    observations: s.observations,
    outbox: s.outbox,
  };
}

// ---------------------------------------------------------------------------
// 登记与合并
// ---------------------------------------------------------------------------

type EntitySlice = Pick<SnapshotData, "samples" | "slides" | "batches" | "observations">;

interface ApplyResult {
  data: EntitySlice;
  events: MergeEvent[];
  error: string | null;
}

/**
 * 登记落库的核心规则（在线登记与离线合并共用）：
 * - 同一玻片 + 同一批次只保留一条观察记录；
 * - 重复视野（倍数+结构相同）并入该记录，不重复计数；
 * - 已有内容（备注、视野）不被后到内容覆盖。
 */
function applyRegistration(data: EntitySlice, p: RegistrationPayload, origin: Origin): ApplyResult {
  const events: MergeEvent[] = [];
  const stain = p.batch.stain.trim();
  const lotNo = p.batch.lotNo.trim();
  const at = nowIso();

  let batches = data.batches;
  let batch = batches.find((b) => b.stain === stain && b.lotNo === lotNo);
  if (batch && batch.status === "invalid") {
    return {
      data,
      events,
      error: `染色批次已失效：${stain} / ${lotNo}，登记暂挂，可恢复批次后重试`,
    };
  }
  if (!batch) {
    batch = { id: uid("bat"), stain, lotNo, status: "active", invalidatedAt: null };
    batches = [...batches, batch];
    events.push(ev("batch", `新建染色批次：${stain} / ${lotNo}`));
  }

  let samples = data.samples;
  let sample = samples.find((s) => s.name === p.sampleName.trim());
  if (!sample) {
    sample = { id: uid("sam"), name: p.sampleName.trim(), type: p.sampleType };
    samples = [...samples, sample];
    events.push(ev("sample", `新建样本：${sample.name}（${sample.type}）`));
  }

  let slides = data.slides;
  let slide = slides.find((s) => s.sampleId === sample.id && s.label === p.slideLabel.trim());
  if (!slide) {
    slide = { id: uid("sld"), sampleId: sample.id, label: p.slideLabel.trim() };
    slides = [...slides, slide];
    events.push(ev("slide", `新建玻片：${slide.label}`));
  }

  let observations = data.observations;
  const existing = observations.find((o) => o.slideId === slide.id && o.batchId === batch.id);
  const label = `${sample.name} / ${slide.label} / ${batch.stain}·${batch.lotNo}`;

  if (!existing) {
    const obs: Observation = {
      id: uid("obs"),
      slideId: slide.id,
      batchId: batch.id,
      status: "draft",
      note: p.note.trim(),
      views: p.views.map((v) => ({
        id: uid("vw"),
        magnification: v.magnification,
        structure: v.structure.trim(),
        note: v.note.trim(),
        createdBy: p.createdBy,
        createdAt: at,
        origin,
      })),
      review: null,
      revision: 1,
      origin,
      createdAt: at,
      updatedAt: at,
    };
    observations = [...observations, obs];
    events.push(ev("inserted", `新建观察记录：${label}（${obs.views.length} 个视野）`));
    return { data: { samples, slides, batches, observations }, events, error: null };
  }

  // 合并进已有记录：重复视野跳过，新视野追加，已有内容不覆盖
  const fingerprints = new Set(existing.views.map(viewFingerprint));
  const added: FieldView[] = [];
  let duplicates = 0;
  for (const v of p.views) {
    const fp = viewFingerprint(v);
    if (fingerprints.has(fp)) {
      duplicates += 1;
      continue;
    }
    fingerprints.add(fp);
    added.push({
      id: uid("vw"),
      magnification: v.magnification,
      structure: v.structure.trim(),
      note: v.note.trim(),
      createdBy: p.createdBy,
      createdAt: at,
      origin,
    });
  }

  let note = existing.note;
  let noteKept = false;
  const incomingNote = p.note.trim();
  if (incomingNote && note.trim() && incomingNote !== note.trim()) {
    noteKept = true; // 后到备注不覆盖先登内容
  } else if (!note.trim() && incomingNote) {
    note = incomingNote; // 原备注为空允许补登，不算覆盖
  }

  const merged: Observation = {
    ...existing,
    note,
    views: [...existing.views, ...added],
    revision: existing.revision + 1,
    updatedAt: at,
  };
  observations = observations.map((o) => (o.id === existing.id ? merged : o));

  if (added.length > 0) {
    events.push(ev("view-merged", `并入 ${added.length} 个新视野 → ${label}`));
  }
  if (duplicates > 0) {
    events.push(ev("view-duplicate", `${duplicates} 个重复视野已并入同一记录（${label}），未重复计数`));
  }
  if (noteKept) {
    events.push(ev("kept-existing", `记录备注保留先登内容，未被后到内容覆盖（${label}）`));
  }
  return { data: { samples, slides, batches, observations }, events, error: null };
}

/** 登记：在线直接落库，断网进入离线队列。返回错误信息或 null。 */
export function registerObservation(payload: RegistrationPayload): string | null {
  if (!state.online) {
    const entry: OutboxEntry = {
      id: uid("ob"),
      queuedAt: nowIso(),
      queuedBy: payload.createdBy,
      payload,
      lastError: null,
    };
    commit(
      { ...state, outbox: [...state.outbox, entry] },
      [
        ev(
          "queued",
          `断网登记已入队：${payload.sampleName} / ${payload.slideLabel}（${payload.views.length} 个视野），待网络恢复后合并`
        ),
      ]
    );
    return null;
  }
  const result = applyRegistration(snapshotData(state), payload, "lab");
  if (result.error) return result.error;
  commit({ ...state, ...result.data }, result.events);
  return null;
}

/** 网络恢复后合并离线队列；异常条目保留在队列中，可重试或回滚 */
export function mergeOutbox() {
  if (!state.online || state.outbox.length === 0) return;

  const snapshot: Snapshot = {
    id: uid("snap"),
    at: nowIso(),
    label: `合并前快照（${state.outbox.length} 条待合并）`,
    data: snapshotData(state),
  };

  let data: EntitySlice = snapshotData(state);
  const events: MergeEvent[] = [ev("merge-start", `开始合并 ${state.outbox.length} 条离线登记`)];
  const remaining: OutboxEntry[] = [];
  let applied = 0;

  for (const entry of state.outbox) {
    const result = applyRegistration(data, entry.payload, "offline");
    if (result.error) {
      remaining.push({ ...entry, lastError: result.error });
      events.push(
        ev("error", `合并异常：${entry.payload.sampleName} / ${entry.payload.slideLabel} — ${result.error}`)
      );
    } else {
      data = result.data;
      applied += 1;
      events.push(...result.events);
    }
  }

  events.push(
    ev(
      "merge-done",
      `合并完成：成功 ${applied} 条，异常 ${remaining.length} 条${
        remaining.length > 0 ? "，可恢复批次后重试或回滚到合并前" : ""
      }`
    )
  );

  commit(
    {
      ...state,
      ...data,
      outbox: remaining,
      snapshots: [snapshot, ...state.snapshots].slice(0, 3),
    },
    events
  );
}

/** 合并异常后的恢复手段之一：回滚到合并前快照，旧数据保留可再次合并 */
export function rollbackToSnapshot(snapshotId: string) {
  const snap = state.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return;
  commit({ ...state, ...snap.data }, [
    ev("rollback", `已回滚到合并前快照（${snap.label}），离线登记保留在队列中可再次合并`),
  ]);
}

// ---------------------------------------------------------------------------
// 染色批次失效与恢复
// ---------------------------------------------------------------------------

export function invalidateBatch(batchId: string) {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status === "invalid") return;
  const at = nowIso();
  let reconfirm = 0;
  let paused = 0;
  const observations = state.observations.map((o) => {
    if (o.batchId !== batchId) return o;
    if (o.status === "confirmed") {
      reconfirm += 1;
      return { ...o, status: "reconfirm" as const, revision: o.revision + 1, updatedAt: at };
    }
    if (o.status === "draft") {
      paused += 1;
      return { ...o, status: "paused" as const, revision: o.revision + 1, updatedAt: at };
    }
    return o;
  });
  const batches = state.batches.map((b) =>
    b.id === batchId ? { ...b, status: "invalid" as const, invalidatedAt: at } : b
  );
  commit({ ...state, batches, observations }, [
    ev(
      "invalidate",
      `染色批次失效：${batch.stain} / ${batch.lotNo} — ${reconfirm} 条已确认观察需重新确认，${paused} 条未完成草稿已暂停`
    ),
  ]);
}

export function restoreBatch(batchId: string) {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status === "active") return;
  const at = nowIso();
  let resumed = 0;
  const observations = state.observations.map((o) => {
    if (o.batchId === batchId && o.status === "paused") {
      resumed += 1;
      return { ...o, status: "draft" as const, revision: o.revision + 1, updatedAt: at };
    }
    return o; // 待重新确认的记录保持原状，需人工复核
  });
  const batches = state.batches.map((b) =>
    b.id === batchId ? { ...b, status: "active" as const, invalidatedAt: null } : b
  );
  commit({ ...state, batches, observations }, [
    ev(
      "restore",
      `染色批次恢复：${batch.stain} / ${batch.lotNo} — ${resumed} 条草稿继续，已确认观察仍需重新确认`
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 复核：同一记录同时提交只通过一份，后到者保留草稿与依据
// ---------------------------------------------------------------------------

interface ReviewResult {
  next: AppState;
  events: MergeEvent[];
  error: string | null;
}

function applyReview(
  s: AppState,
  obsId: string,
  reviewer: string,
  rationale: string,
  baseRevision: number
): ReviewResult {
  const obs = s.observations.find((o) => o.id === obsId);
  if (!obs) return { next: s, events: [], error: "记录不存在" };
  if (!rationale.trim()) return { next: s, events: [], error: "请填写复核依据" };
  if (obs.status === "paused") {
    return { next: s, events: [], error: "草稿已暂停（染色批次失效），暂不能复核" };
  }
  if (obs.revision !== baseRevision) {
    // 他人已先通过：本次不覆盖，草稿与依据保留
    const draft: ReviewDraft = {
      id: uid("rd"),
      obsId,
      reviewer,
      rationale: rationale.trim(),
      keptAt: nowIso(),
      reason: `复核冲突：提交基于修订 r${baseRevision}，当前已是 r${obs.revision}，他人已先通过`,
    };
    return {
      next: { ...s, reviewDrafts: [draft, ...s.reviewDrafts] },
      events: [ev("review-conflict", `复核冲突：${reviewer} 的提交未通过，草稿与依据已保留`)],
      error: "复核冲突：他人已先通过，你的草稿与依据已保留，可在详情中重新提交",
    };
  }
  if (obs.status === "confirmed") {
    return { next: s, events: [], error: "记录已确认，无需重复复核" };
  }
  const at = nowIso();
  const observations = s.observations.map((o) =>
    o.id === obsId
      ? {
          ...o,
          status: "confirmed" as const,
          review: { reviewer, rationale: rationale.trim(), at },
          revision: o.revision + 1,
          updatedAt: at,
        }
      : o
  );
  return {
    next: { ...s, observations },
    events: [ev("review-passed", `复核通过：${reviewer} 确认了一条观察记录（r${baseRevision} → r${baseRevision + 1}）`)],
    error: null,
  };
}

/** 提交复核。baseRevision 为打开详情时的修订号，模拟并发复核的乐观锁。 */
export function submitReview(
  obsId: string,
  reviewer: string,
  rationale: string,
  baseRevision: number
): string | null {
  const result = applyReview(state, obsId, reviewer, rationale, baseRevision);
  if (result.events.length > 0 || result.error === null) {
    commit(result.next, result.events);
  }
  return result.error;
}

/** 保留的复核草稿按当前修订号重新提交 */
export function resubmitDraft(draftId: string): string | null {
  const draft = state.reviewDrafts.find((d) => d.id === draftId);
  if (!draft) return "草稿不存在";
  const obs = state.observations.find((o) => o.id === draft.obsId);
  if (!obs) return "记录不存在";
  const result = applyReview(state, draft.obsId, draft.reviewer, draft.rationale, obs.revision);
  if (result.error) {
    if (result.events.length > 0) commit(result.next, result.events);
    return result.error;
  }
  commit(
    { ...result.next, reviewDrafts: result.next.reviewDrafts.filter((d) => d.id !== draftId) },
    [...result.events, ev("draft-resolved", `保留的复核草稿已由 ${draft.reviewer} 重新提交并通过`)]
  );
  return null;
}

export function discardDraft(draftId: string) {
  const draft = state.reviewDrafts.find((d) => d.id === draftId);
  if (!draft) return;
  commit({ ...state, reviewDrafts: state.reviewDrafts.filter((d) => d.id !== draftId) }, [
    ev("draft-discarded", `已丢弃 ${draft.reviewer} 保留的复核草稿`),
  ]);
}

// ---------------------------------------------------------------------------
// 网络与演示
// ---------------------------------------------------------------------------

export function setOnline(online: boolean) {
  if (state.online === online) return;
  commit(
    { ...state, online },
    [ev("net", online ? "网络已恢复，离线登记可合并到室内记录" : "已断网，新登记将进入离线队列")],
    false
  );
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // 忽略
  }
  state = seedState();
  persist();
  listeners.forEach((fn) => fn());
}
