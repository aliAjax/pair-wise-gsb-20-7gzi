import {
  CURRENT_SCHEMA,
  CoreState,
  FieldDraft,
  FieldProvenance,
  MergeReport,
  ObservationRecord,
  ObservationStatus,
  SyncOp,
  SyncPack,
  AnomalyKind,
} from "./types";

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function nowTs(): number {
  return Date.now();
}

/** 玻片 + 染色批次 = 观察记录的自然键（两端各自生成也能收敛到同一条记录） */
export function recordNaturalKey(slideCode: string, batchCode: string): string {
  return `${slideCode.trim()}::${batchCode.trim()}`;
}

export function recordId(slideCode: string, batchCode: string): string {
  return `rec::${recordNaturalKey(slideCode, batchCode)}`;
}

export function sampleId(code: string): string {
  return `smp::${code.trim()}`;
}

export function batchId(code: string): string {
  return `bat::${code.trim()}`;
}

export function fieldKey(f: Pick<FieldDraft, "magnification" | "structure">): string {
  return `${f.magnification.trim().toLowerCase()}@${f.structure.trim().toLowerCase()}`;
}

/** 空状态（schemaVersion 始终用当前版本，旧数据走 migrate） */
export function emptyCore(): CoreState {
  return {
    schemaVersion: CURRENT_SCHEMA,
    samples: {},
    batches: {},
    records: {},
    appliedOpIds: [],
    anomalies: [],
  };
}

export function cloneCore(core: CoreState): CoreState {
  return JSON.parse(JSON.stringify(core)) as CoreState;
}

/**
 * 旧版本数据兼容迁入：保留全部旧数据，仅补齐字段并打 compat 标记。
 * 看板、详情、导出永远只面对迁移后的统一结构。
 */
export function migrate(core: CoreState): CoreState {
  const next = cloneCore(core);
  const from = next.schemaVersion ?? 1;
  if (from >= CURRENT_SCHEMA) return next;

  next.schemaVersion = CURRENT_SCHEMA;
  for (const rec of Object.values(next.records)) {
    rec.compat = true;
    rec.fields ??= [];
    rec.reviews ??= [];
    rec.notes ??= [];
    rec.version ??= 1;
    for (const f of rec.fields) {
      f.sources ??= [];
      f.alternates ??= [];
    }
    for (const r of rec.reviews) {
      r.accepted ??= true;
      r.state ??= "accepted";
      r.basis ??= "（旧版本复核记录，依据未登记）";
    }
    // v1 草稿/确认之外的状态在 v2 之后才出现
    if (rec.status !== "draft" && rec.status !== "confirmed") {
      rec.status = "confirmed";
    }
  }
  next.anomalies ??= [];
  next.appliedOpIds ??= [];
  return next;
}

function makeAnomaly(
  kind: AnomalyKind,
  message: string,
  pack: SyncPack,
  opId: string | undefined,
): CoreState["anomalies"][number] {
  return {
    id: uid("anm"),
    kind,
    message,
    packId: pack.packId,
    pack,
    opId,
    createdAt: nowTs(),
    resolved: false,
  };
}

function hasConfirmedContent(rec: ObservationRecord, incomingConfirmed: boolean): boolean {
  return (
    incomingConfirmed ||
    rec.status === "confirmed" ||
    rec.status === "reconfirm" ||
    !!rec.approvedBy
  );
}

/** 批次有效性对状态的门控：失效后已确认→重新确认，草稿→停住 */
export function gateStatusByBatch(
  status: ObservationStatus,
  hasConfirmed: boolean,
  batchActive: boolean,
): ObservationStatus {
  if (!batchActive) return hasConfirmed ? "reconfirm" : "paused";
  if (status === "reconfirm") return "confirmed";
  if (status === "paused") return "draft";
  return status;
}

function applyField(
  rec: ObservationRecord,
  draft: FieldDraft,
  source: FieldProvenance,
): { added: boolean; blocked: string | undefined } {
  const key = fieldKey(draft);
  const existing = rec.fields.find((f) => f.key === key);
  if (!existing) {
    rec.fields.push({
      key,
      magnification: draft.magnification.trim(),
      structure: draft.structure.trim(),
      description: draft.description, // 首次写入
      fieldId: uid("fld"),
      sources: [source],
      alternates: [],
    });
    return { added: true, blocked: undefined };
  }
  existing.sources.push(source);
  // 后到内容不得覆盖：不同描述保留为"被拦截的后到值"，原值不动
  if (draft.description.trim() && draft.description !== existing.description) {
    existing.alternates.push({ description: draft.description, source });
    return {
      added: false,
      blocked: `${existing.magnification} ${existing.structure}：「${draft.description}」未覆盖原值「${existing.description}」`,
    };
  }
  return { added: false, blocked: undefined };
}

/**
 * 合并一个离线包。纯函数：不改入参，返回新 core 与报告。
 * 整个包 schema 不认识 → 整包隔离；单条 op 异常 → 隔离该条，其余继续合并。
 */
export function mergePack(input: CoreState, pack: SyncPack): { core: CoreState; report: MergeReport } {
  const core = cloneCore(input);
  const report: MergeReport = {
    applied: [],
    skipped: [],
    merged: [],
    anomalyIds: [],
    quarantined: false,
  };

  if (!pack || !Array.isArray(pack.ops) || typeof pack.packId !== "string") {
    const anm = makeAnomaly("malformed", "数据包结构损坏，缺少 packId/ops", pack, undefined);
    core.anomalies.push(anm);
    report.anomalyIds.push(anm.id);
    report.quarantined = true;
    return { core, report };
  }

  // 高版本数据：旧端无法解释，整包保留待恢复（升级后可重新合入）
  if (typeof pack.schemaVersion !== "number" || pack.schemaVersion > CURRENT_SCHEMA) {
    const anm = makeAnomaly(
      "unknown-schema",
      `数据包版本 v${pack.schemaVersion} 高于当前 v${CURRENT_SCHEMA}，整包暂缓合入`,
      pack,
      undefined,
    );
    core.anomalies.push(anm);
    report.anomalyIds.push(anm.id);
    report.quarantined = true;
    return { core, report };
  }

  // 样本/批次先于观察落地，保证引用可解析
  const ops = [...pack.ops].sort((a, b) => {
    const weight = { sample: 0, batch: 1, observation: 2 } as const;
    return weight[a.type] - weight[b.type];
  });

  for (const op of ops as SyncOp[]) {
    if (!op || !op.opId) {
      const anm = makeAnomaly("malformed", "操作缺少 opId", pack, undefined);
      core.anomalies.push(anm);
      report.anomalyIds.push(anm.id);
      continue;
    }
    if (core.appliedOpIds.includes(op.opId)) {
      report.skipped.push(op.opId); // 幂等：重传/恢复时不重复合并
      continue;
    }

    if (op.type === "sample") {
      const id = sampleId(op.code);
      if (!core.samples[id]) {
        core.samples[id] = {
          id,
          code: op.code.trim(),
          name: op.name,
          category: op.category,
          createdAt: op.createdAt,
          origin: "offline",
        };
      }
      core.appliedOpIds.push(op.opId);
      report.applied.push(op.opId);
      continue;
    }

    if (op.type === "batch") {
      const id = batchId(op.code);
      const existing = core.batches[id];
      if (existing && existing.method !== op.method) {
        const anm = makeAnomaly(
          "conflicting-entity",
          `染色批次 ${op.code} 已登记为「${existing.method}」，离线包登记为「${op.method}」`,
          pack,
          op.opId,
        );
        core.anomalies.push(anm);
        report.anomalyIds.push(anm.id);
        continue; // 冲突批次保持原值，op 不标记 applied，恢复时可重新处理
      }
      if (!existing) {
        core.batches[id] = {
          id,
          code: op.code.trim(),
          method: op.method,
          status: "active",
          createdAt: op.createdAt,
          origin: "offline",
        };
      }
      core.appliedOpIds.push(op.opId);
      report.applied.push(op.opId);
      continue;
    }

    if (op.type === "observation") {
      const sId = sampleId(op.sampleCode);
      const bId = batchId(op.batchCode);
      const sample = core.samples[sId];
      const batch = core.batches[bId];
      if (!sample || !batch) {
        const anm = makeAnomaly(
          "unresolved-ref",
          `观察引用缺失：${!sample ? `样本 ${op.sampleCode}` : ""}${!sample && !batch ? "、" : ""}${
            !batch ? `染色批次 ${op.batchCode}` : ""
          }`,
          pack,
          op.opId,
        );
        core.anomalies.push(anm);
        report.anomalyIds.push(anm.id);
        continue;
      }

      const id = recordId(op.slideCode, op.batchCode);
      const ts = nowTs();
      let rec = core.records[id];
      const isNew = !rec;
      if (isNew) {
        rec = {
          id,
          sampleId: sample.id,
          sampleCode: sample.code,
          slideCode: op.slideCode.trim(),
          batchId: batch.id,
          batchCode: batch.code,
          status: "draft",
          fields: [],
          reviews: [],
          version: 0,
          createdAt: ts,
          updatedAt: ts,
          notes: [],
        };
        core.records[id] = rec;
      }

      const detail = { existing: rec.fields.length, added: 0, blockedWrites: [] as string[] };
      for (const draft of op.fields) {
        const source: FieldProvenance = {
          deviceId: pack.deviceId,
          teacher: pack.teacher,
          clientOpId: op.opId,
          observedAt: op.observedAt,
          arrivedAt: ts,
        };
        const r = applyField(rec, draft, source);
        if (r.added) detail.added += 1;
        if (r.blocked) detail.blockedWrites.push(r.blocked);
      }

      const incomingConfirmed = op.status === "confirmed";
      const hasConfirmed = hasConfirmedContent(rec, incomingConfirmed);
      rec.status = gateStatusByBatch(rec.status, hasConfirmed, batch.status === "active");
      rec.updatedAt = ts;
      rec.version += 1;
      rec.notes.push({
        at: ts,
        text: `${isNew ? "创建" : "合并"}自${pack.deviceId}（${pack.teacher}）：${op.fields.length} 个视野，${
          detail.added
        } 个新增${detail.blockedWrites.length ? `，${detail.blockedWrites.length} 处后到内容被保留未覆盖` : ""}`,
      });

      report.merged.push({
        recordId: id,
        slideCode: rec.slideCode,
        batchCode: rec.batchCode,
        detail,
      });
      core.appliedOpIds.push(op.opId);
      report.applied.push(op.opId);
      continue;
    }

    const anm = makeAnomaly("malformed", `未知操作类型：${(op as { type: string }).type}`, pack, (op as SyncOp).opId);
    core.anomalies.push(anm);
    report.anomalyIds.push(anm.id);
  }

  return { core, report };
}

/** 室内记录与合并结果对齐：室内侧本身也用同一自然键，这里做一次双向对账合并 */
export function reconcileIndoor(core: CoreState, indoor: CoreState): CoreState {
  let result = cloneCore(core);
  // 把室内侧逐条打成虚拟包走同一套合并规则，保证规则只有一份
  const ops: SyncOp[] = [];
  for (const s of Object.values(indoor.samples)) {
    if (!result.samples[s.id]) {
      ops.push({ type: "sample", opId: `indoor-s-${s.id}`, code: s.code, name: s.name, category: s.category, createdAt: s.createdAt });
    }
  }
  for (const b of Object.values(indoor.batches)) {
    if (!result.batches[b.id]) {
      ops.push({ type: "batch", opId: `indoor-b-${b.id}`, code: b.code, method: b.method, createdAt: b.createdAt });
    }
  }
  if (ops.length) {
    result = mergePack(result, {
      packId: uid("pk"),
      deviceId: "indoor",
      teacher: "室内记录",
      schemaVersion: CURRENT_SCHEMA,
      packedAt: nowTs(),
      ops,
    }).core;
  }
  return result;
}
