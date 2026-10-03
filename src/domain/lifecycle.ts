import { CoreState, MergeAnomaly, ObservationRecord, Review } from "./types";
import { batchId, cloneCore, mergePack, nowTs, recordId, uid } from "./merge";

export interface ActionResult {
  core: CoreState;
  ok: boolean;
  message: string;
}

function touch(rec: ObservationRecord, text: string): ObservationRecord {
  rec.updatedAt = nowTs();
  rec.notes.push({ at: rec.updatedAt, text });
  return rec;
}

/**
 * 染色批次失效：
 * - 已确认（含已复核）的观察 → reconfirm，必须重新确认
 * - 未完成草稿 → paused，先停住，不允许继续提交/复核
 * 已有数据全部保留，只改状态。
 */
export function invalidateBatch(input: CoreState, batchCode: string, reason: string): ActionResult {
  const core = cloneCore(input);
  const batch = core.batches[batchId(batchCode)];
  if (!batch) return { core: input, ok: false, message: `批次 ${batchCode} 不存在` };
  if (batch.status === "invalid") {
    return { core: input, ok: false, message: `批次 ${batchCode} 已处于失效状态` };
  }
  batch.status = "invalid";
  batch.invalidAt = nowTs();
  batch.invalidReason = reason || "未填写原因";

  let reconfirm = 0;
  let paused = 0;
  for (const rec of Object.values(core.records)) {
    if (rec.batchId !== batch.id) continue;
    const hadConfirmation = rec.status === "confirmed" || rec.status === "reconfirm" || !!rec.approvedBy;
    rec.status = hadConfirmation ? "reconfirm" : "paused";
    if (hadConfirmation) reconfirm += 1;
    else paused += 1;
    touch(
      rec,
      `染色批次 ${batch.code} 失效（${batch.invalidReason}）：${hadConfirmation ? "已确认观察需重新确认" : "未完成草稿停住"}`,
    );
    rec.version += 1;
  }
  return {
    core,
    ok: true,
    message: `批次 ${batchCode} 已失效：${reconfirm} 条转重新确认，${paused} 条草稿停住`,
  };
}

/** 恢复/更换有效批次后，停住的草稿可继续 */
export function restoreBatch(input: CoreState, batchCode: string): ActionResult {
  const core = cloneCore(input);
  const batch = core.batches[batchId(batchCode)];
  if (!batch) return { core: input, ok: false, message: `批次 ${batchCode} 不存在` };
  if (batch.status === "active") return { core: input, ok: false, message: "批次本就有效" };
  batch.status = "active";
  batch.invalidAt = undefined;
  batch.invalidReason = undefined;
  let n = 0;
  for (const rec of Object.values(core.records)) {
    if (rec.batchId !== batch.id) continue;
    if (rec.status === "reconfirm" || rec.status === "paused") {
      rec.version += 1;
      touch(
        rec,
        `批次 ${batch.code} 恢复有效：${rec.status === "reconfirm" ? "请教师重新确认" : "草稿解除停住，可继续"}`,
      );
      n += 1;
    }
  }
  return { core, ok: true, message: `批次 ${batchCode} 已恢复有效，${n} 条记录等待处理` };
}

export function resumePaused(input: CoreState, slideCode: string, batchCode: string): ActionResult {
  const core = cloneCore(input);
  const rec = core.records[recordId(slideCode, batchCode)];
  if (!rec) return { core: input, ok: false, message: "记录不存在" };
  const batch = core.batches[rec.batchId];
  if (batch.status !== "active") {
    return { core: input, ok: false, message: `批次 ${batch.code} 仍失效，无法继续` };
  }
  if (rec.status !== "paused") {
    return { core: input, ok: false, message: "仅停住的草稿可以继续" };
  }
  rec.status = "draft";
  rec.version += 1;
  touch(rec, "批次恢复有效，草稿解除停住");
  return { core, ok: true, message: "草稿已解除停住，可继续登记" };
}

/** 教师重新确认（批次失效后必须执行） */
export function reconfirm(input: CoreState, slideCode: string, batchCode: string, teacher: string): ActionResult {
  const core = cloneCore(input);
  const rec = core.records[recordId(slideCode, batchCode)];
  if (!rec) return { core: input, ok: false, message: "记录不存在" };
  const batch = core.batches[rec.batchId];
  if (batch.status === "invalid") {
    return { core: input, ok: false, message: "批次仍失效，需先恢复或改挂新批次" };
  }
  if (rec.status !== "reconfirm") {
    return { core: input, ok: false, message: "该记录当前不需要重新确认" };
  }
  rec.status = "confirmed";
  rec.lastReconfirmedAt = nowTs();
  rec.version += 1;
  touch(rec, `${teacher} 已重新确认（原批次失效后的复认）`);
  return { core, ok: true, message: "重新确认完成" };
}

export interface ReviewInput {
  teacher: string;
  basis: string;
  submittedAt: number;
  clientOpId?: string;
  /** 复核发起时看到的记录版本；与当前不一致说明两人同时提交 */
  baseVersion: number;
}

/**
 * 两人同时提交复核（相同 baseVersion 的并发提交）：
 * 只接受第一份，后到者整份（结论+依据+时间）保留为草稿，不覆盖任何内容。
 * 即使版本号恰好错开，只要上一份 accepted 也是在同一"复核轮次"内到达，后到同样降级。
 */
export function submitReview(
  input: CoreState,
  slideCode: string,
  batchCode: string,
  rv: ReviewInput,
): ActionResult & { reviewId?: string } {
  const core = cloneCore(input);
  const rec = core.records[recordId(slideCode, batchCode)];
  if (!rec) return { core: input, ok: false, message: "记录不存在" };
  if (rec.status === "paused") {
    return { core: input, ok: false, message: "记录处于停住状态，不能提交复核" };
  }
  if (rec.status === "draft" || rec.status === "reconfirm") {
    return { core: input, ok: false, message: rec.status === "reconfirm" ? "批次失效后需先重新确认" : "草稿需先确认才能复核" };
  }
  if (!rv.basis.trim()) {
    return { core: input, ok: false, message: "必须填写复核依据" };
  }

  const roundStart = rec.lastReconfirmedAt ?? rec.approvedAt ?? rec.createdAt;
  const concurrentAccepted = rec.reviews.find(
    (r) => r.accepted && r.state === "accepted" && r.submittedAt >= roundStart,
  );

  const review: Review = {
    id: uid("rev"),
    teacher: rv.teacher,
    verdict: "approve",
    basis: rv.basis,
    submittedAt: rv.submittedAt,
    clientOpId: rv.clientOpId,
    accepted: false,
    state: "draft",
    recordVersion: rec.version,
  };

  if (rv.baseVersion !== rec.version || concurrentAccepted) {
    // 后到者：保留草稿与依据
    review.rejectReason = concurrentAccepted
      ? `同时段 ${concurrentAccepted.teacher} 的复核已通过（版本 ${rv.baseVersion}→${rec.version}），本份保留为草稿`
      : `记录已被其他复核更新（版本 ${rv.baseVersion}→${rec.version}），本份保留为草稿`;
    rec.reviews.push(review);
    rec.version += 1;
    touch(rec, `${rv.teacher} 的并发复核未通过，结论与依据保留为草稿`);
    return { core, ok: false, reviewId: review.id, message: review.rejectReason };
  }

  review.accepted = true;
  review.state = "accepted";
  rec.reviews.push(review);
  rec.approvedBy = rv.teacher;
  rec.approvedAt = rv.submittedAt;
  rec.version += 1;
  touch(rec, `${rv.teacher} 复核通过：${rv.basis}`);
  return { core, ok: true, reviewId: review.id, message: "复核通过" };
}

/** 恢复合并异常：原始包始终保留，按异常类型决定恢复方式 */
export function recoverAnomaly(
  input: CoreState,
  anomalyId: string,
  opts: { force?: boolean } = {},
): ActionResult {
  const core = cloneCore(input);
  const idx = core.anomalies.findIndex((a) => a.id === anomalyId);
  if (idx < 0) return { core: input, ok: false, message: "异常不存在" };
  const anomaly = core.anomalies[idx] as MergeAnomaly;
  if (anomaly.resolved) return { core: input, ok: false, message: "异常已处理过" };

  // unknown-schema：升级后当前版本能解释了，重新合入（已合入的 op 幂等跳过）
  let repack = anomaly.pack;
  if (anomaly.kind === "unknown-schema") {
    if (anomaly.pack.schemaVersion > 3 && !opts.force) {
      return { core: input, ok: false, message: "当前仍低于数据包版本，强制恢复将按当前结构兼容解释" };
    }
    if (opts.force) {
      // 强制恢复：按当前版本重新解释，未知字段丢弃，已知数据全部保留
      repack = { ...anomaly.pack, schemaVersion: 3 };
    }
  }

  if (anomaly.kind === "conflicting-entity" && !opts.force) {
    return { core: input, ok: false, message: "实体冲突需确认保留哪一侧；强制恢复将保留室内原值" };
  }

  const { core: merged, report } = mergePack(core, repack);
  const stillOpen = merged.anomalies.filter((a) => !a.resolved && a.id !== anomaly.id);
  // 强制恢复冲突时：新产生的同类冲突直接标记为"已按保留室内侧处理"
  for (const a of stillOpen) {
    if (a.packId === anomaly.packId && a.kind === anomaly.kind) {
      a.resolved = true;
      a.resolution = "强制恢复：保留室内原值，后到内容随原始包归档";
    }
  }
  const target = merged.anomalies.find((a) => a.id === anomaly.id);
  if (target) {
    target.resolved = true;
    target.resolution = opts.force
      ? "强制恢复合入（旧数据保留，冲突以室内侧为准）"
      : `重新合入完成：${report.applied.length} 条操作应用，${report.skipped.length} 条幂等跳过`;
  }
  return {
    core: merged,
    ok: true,
    message: target?.resolution ?? "异常已恢复",
  };
}

/** 丢弃无法使用的异常包（原始包仍在该异常记录里归档，不物理删除） */
export function dismissAnomaly(input: CoreState, anomalyId: string): ActionResult {
  const core = cloneCore(input);
  const anomaly = core.anomalies.find((a) => a.id === anomalyId);
  if (!anomaly) return { core: input, ok: false, message: "异常不存在" };
  anomaly.resolved = true;
  anomaly.resolution = "已忽略，原始包保留在归档中";
  return { core, ok: true, message: "异常已归档（数据未删除）" };
}
