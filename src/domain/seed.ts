import { CoreState, FieldDraft, SyncPack } from "./types";
import { batchId, emptyCore, recordId, sampleId, nowTs, uid } from "./merge";

const MIN = 60_000;

/** 室内已有记录：洋葱表皮 S-001 + 染色批次 I-07，400x 已有一个视野 */
export function seedIndoor(): CoreState {
  const core = emptyCore();
  const t = nowTs();
  core.samples[sampleId("S-001")] = {
    id: sampleId("S-001"),
    code: "S-001",
    name: "洋葱表皮",
    category: "植物组织",
    createdAt: t - 120 * MIN,
    origin: "indoor",
  };
  core.batches[batchId("I-07")] = {
    id: batchId("I-07"),
    code: "I-07",
    method: "碘液染色",
    status: "active",
    createdAt: t - 110 * MIN,
    origin: "indoor",
  };
  const rid = recordId("BP-12", "I-07");
  core.records[rid] = {
    id: rid,
    sampleId: sampleId("S-001"),
    sampleCode: "S-001",
    slideCode: "BP-12",
    batchId: batchId("I-07"),
    batchCode: "I-07",
    status: "confirmed",
    fields: [
      {
        key: "400x@细胞核",
        magnification: "400x",
        structure: "细胞核",
        description: "细胞壁清晰，细胞核可见（室内值）",
        fieldId: uid("fld"),
        sources: [
          { deviceId: "indoor", teacher: "室内记录台", clientOpId: "indoor-seed", observedAt: t - 100 * MIN, arrivedAt: t - 100 * MIN },
        ],
        alternates: [],
      },
    ],
    reviews: [],
    version: 1,
    createdAt: t - 100 * MIN,
    updatedAt: t - 90 * MIN,
    notes: [{ at: t - 90 * MIN, text: "室内台已确认" }],
  };
  return core;
}

function observationPack(partial: {
  packId: string;
  deviceId: string;
  teacher: string;
  sampleCode: string;
  slideCode: string;
  batchCode: string;
  fields: FieldDraft[];
  status: "draft" | "confirmed";
  minutesAgo: number;
  schemaVersion?: number;
  method?: string;
  sampleName?: string;
  category?: string;
}): SyncPack {
  const t = nowTs() - partial.minutesAgo * MIN;
  const ops: SyncPack["ops"] = [
    { type: "sample", opId: uid("op"), code: partial.sampleCode, name: partial.sampleName ?? partial.sampleCode, category: partial.category ?? "植物组织", createdAt: t },
    { type: "batch", opId: uid("op"), code: partial.batchCode, method: partial.method ?? "碘液染色", createdAt: t },
    {
      type: "observation",
      opId: uid("op"),
      sampleCode: partial.sampleCode,
      slideCode: partial.slideCode,
      batchCode: partial.batchCode,
      fields: partial.fields,
      status: partial.status,
      observedAt: t,
    },
  ];
  return {
    packId: partial.packId,
    deviceId: partial.deviceId,
    teacher: partial.teacher,
    schemaVersion: partial.schemaVersion ?? 3,
    packedAt: t + 5000,
    ops,
  };
}

/** 断网期间 2 号镜台登记：同一玻片同一批次，重复 400x 视野（描述不同）+ 新增 1000x */
export function offlinePackA(): SyncPack {
  return observationPack({
    packId: "pack-A",
    deviceId: "scope-table-02",
    teacher: "王老师",
    sampleCode: "S-001",
    sampleName: "洋葱表皮",
    slideCode: "BP-12",
    batchCode: "I-07",
    status: "confirmed",
    minutesAgo: 60,
    fields: [
      { magnification: "400x", structure: "细胞核", description: "细胞核染色较深（后到，不应覆盖室内值）" },
      { magnification: "1000x", structure: "细胞壁", description: "细胞壁纹理连续，新增视野" },
    ],
  });
}

/** 另一台设备对同玻片同批次的重复登记（幂等场景 + 第三处视野） */
export function offlinePackB(): SyncPack {
  return observationPack({
    packId: "pack-B",
    deviceId: "mobile-scope-05",
    teacher: "李老师",
    sampleCode: "S-001",
    sampleName: "洋葱表皮",
    slideCode: "BP-12",
    batchCode: "I-07",
    status: "draft",
    minutesAgo: 45,
    fields: [{ magnification: "200x", structure: "表皮细胞排列", description: "细胞呈规则砖形排列" }],
  });
}

/** 高版本数据包 → 触发 unknown-schema 合并异常（可恢复） */
export function futureSchemaPack(): SyncPack {
  return observationPack({
    packId: "pack-future",
    deviceId: "scope-table-03",
    teacher: "赵老师",
    sampleCode: "S-009",
    sampleName: "未知样本",
    slideCode: "BP-30",
    batchCode: "I-99",
    method: "新型荧光染色",
    status: "confirmed",
    minutesAgo: 30,
    schemaVersion: 99,
    fields: [{ magnification: "400x", structure: "荧光点", description: "高版本字段，旧端不认识" }],
  });
}

/** 批次方法冲突 → conflicting-entity 异常 */
export function conflictingBatchPack(): SyncPack {
  return observationPack({
    packId: "pack-conflict",
    deviceId: "scope-table-04",
    teacher: "孙老师",
    sampleCode: "S-001",
    sampleName: "洋葱表皮",
    slideCode: "BP-12",
    batchCode: "I-07",
    method: "结晶紫染色", // 与室内"碘液染色"冲突
    status: "draft",
    minutesAgo: 20,
    fields: [{ magnification: "100x", structure: "表皮全貌", description: "低倍全貌" }],
  });
}
