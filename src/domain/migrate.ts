import { Observation, Sample, Slide, StainBatch, nowIso, uid } from "./types";

/**
 * 旧版 v1 数据格式：扁平记录行
 * [样本名称, 样本类型, 染色方式, 放大倍数, 视野描述]
 */
export interface LegacyPayload {
  records: string[][];
}

/**
 * 旧数据兼容迁移：v1 扁平记录 → v2 样本/玻片/批次/观察记录。
 * 迁移不丢弃原始数据，原始 payload 由调用方存入 legacyArchive。
 */
export function migrateLegacyV1(raw: LegacyPayload): {
  samples: Sample[];
  slides: Slide[];
  batches: StainBatch[];
  observations: Observation[];
} {
  const samples: Sample[] = [];
  const slides: Slide[] = [];
  const batches: StainBatch[] = [];
  const observations: Observation[] = [];
  const at = nowIso();

  raw.records.forEach((row, index) => {
    const [name, type, stain, magnification, note] = row;

    let sample = samples.find((s) => s.name === name);
    if (!sample) {
      sample = { id: uid("sam"), name, type };
      samples.push(sample);
    }

    let batch = batches.find((b) => b.stain === stain);
    if (!batch) {
      batch = { id: uid("bat"), stain, lotNo: "LEGACY", status: "active", invalidatedAt: null };
      batches.push(batch);
    }

    const slide: Slide = {
      id: uid("sld"),
      sampleId: sample.id,
      label: `SL-${String(index + 1).padStart(3, "0")}`,
    };
    slides.push(slide);

    observations.push({
      id: uid("obs"),
      slideId: slide.id,
      batchId: batch.id,
      status: "confirmed",
      note: "旧版 v1 记录迁移",
      views: [
        {
          id: uid("vw"),
          magnification: magnification || "未标注",
          structure: "未标注",
          note: note || "",
          createdBy: "旧版数据",
          createdAt: at,
          origin: "lab",
        },
      ],
      review: { reviewer: "旧版数据", rationale: "v1 历史记录迁移", at },
      revision: 1,
      origin: "lab",
      createdAt: at,
      updatedAt: at,
    });
  });

  return { samples, slides, batches, observations };
}
