import { mergePack, migrate, gateStatusByBatch, emptyCore } from "../src/domain/merge";
import {
  invalidateBatch,
  submitReview,
  resumePaused,
  reconfirm,
  recoverAnomaly,
  dismissAnomaly,
} from "../src/domain/lifecycle";
import { commit, createRepo, currentCore, exportSnapshot, rollback } from "../src/domain/versions";
import {
  seedIndoor,
  offlinePackA,
  offlinePackB,
  futureSchemaPack,
  conflictingBatchPack,
} from "../src/domain/seed";
import { CoreState, SyncPack } from "../src/domain/types";
import { recordId } from "../src/domain/merge";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, want ${e}`);
}

// ---------- 场景 1：断网合并 + 同玻片同批次重复视野并入一条，后到不覆盖 ----------
{
  let core = seedIndoor();
  const packA = offlinePackA();
  const rA = mergePack(core, packA);
  core = rA.core;
  const rec = core.records[recordId("BP-12", "I-07")];

  ok("合并后仍只有一条 BP-12/I-07 记录", Object.keys(core.records).length === 1);
  eq("重复 400x 并入同一字段，新增 1000x（共 2 个视野）", rec.fields.length, 2);
  const f400 = rec.fields.find((f) => f.key === "400x@细胞核")!;
  eq("同一视野两次来源", f400.sources.length, 2);
  ok("后到描述不覆盖原值", f400.description.includes("室内值"), f400.description);
  eq("被拦截的后到值保留为依据", f400.alternates.length, 1);
  ok("合并审计可见", rec.notes.some((n) => n.text.includes("scope-table-02")));

  // 第二台设备：幂等 + 第三视野并入同一条
  const rB = mergePack(core, offlinePackB());
  core = rB.core;
  const rec2 = core.records[recordId("BP-12", "I-07")];
  eq("再次合并后仍一条记录、3 个视野", [Object.keys(core.records).length, rec2.fields.length], [1, 3]);

  // 重传同一包：全部幂等跳过
  const rA2 = mergePack(core, packA);
  eq("重复包操作全部幂等跳过", rA2.report.skipped.length, 3);
  eq("幂等重传不产生重复来源", rA2.core.records[rec.id].fields.find((f) => f.key === "400x@细胞核")!.sources.length, 2);
}

// ---------- 场景 2：染色批次失效 ----------
{
  let core = seedIndoor();
  core = mergePack(core, offlinePackA()).core;
  const confirmedRec = core.records[recordId("BP-12", "I-07")];
  eq("失效前记录为已确认", confirmedRec.status, "confirmed");

  // 再造一条纯草稿记录（另一玻片同批次）
  const draftPack: SyncPack = {
    packId: "pack-draft",
    deviceId: "scope-table-06",
    teacher: "周老师",
    schemaVersion: 3,
    packedAt: Date.now(),
    ops: [
      { type: "sample", opId: "s-d2", code: "S-001", name: "洋葱表皮", category: "植物组织", createdAt: Date.now() },
      { type: "batch", opId: "b-d2", code: "I-07", method: "碘液染色", createdAt: Date.now() },
      {
        type: "observation",
        opId: "o-d2",
        sampleCode: "S-001",
        slideCode: "BP-18",
        batchCode: "I-07",
        fields: [{ magnification: "100x", structure: "全貌", description: "只看了一眼的草稿" }],
        status: "draft",
        observedAt: Date.now(),
      },
    ],
  };
  core = mergePack(core, draftPack).core;

  const inv = invalidateBatch(core, "I-07", "染色试剂过期");
  ok("批次失效操作成功", inv.ok, inv.message);
  core = inv.core;
  eq("已确认观察 → 待重新确认", core.records[recordId("BP-12", "I-07")].status, "reconfirm");
  eq("未完成草稿 → 停住", core.records[recordId("BP-18", "I-07")].status, "paused");
  eq("批次状态为失效", core.batches["bat::I-07"].status, "invalid");

  // 失效期间：复核被拦截；重新确认也因批次仍失效被拦截
  const revBlocked = submitReview(core, "BP-12", "I-07", { teacher: "王老师", basis: "b", submittedAt: Date.now(), baseVersion: 99 });
  ok("reconfirm 状态复核被拦截", !revBlocked.ok);
  const recConf = reconfirm(core, "BP-12", "I-07", "王老师");
  ok("批次仍失效时不允许重新确认", !recConf.ok);

  // 批次恢复（实验上：把 batch 置回 active，模拟换了有效试剂批次）
  core.batches["bat::I-07"].status = "active";
  delete core.batches["bat::I-07"].invalidAt;
  const rc = reconfirm(core, "BP-12", "I-07", "王老师");
  ok("有效批次下重新确认成功", rc.ok, rc.message);
  core = rc.core;
  eq("重新确认后回到已确认", core.records[recordId("BP-12", "I-07")].status, "confirmed");
  const rs = resumePaused(core, "BP-18", "I-07");
  ok("停住草稿恢复成功", rs.ok, rs.message);
  eq("草稿解除停住", rs.core.records[recordId("BP-18", "I-07")].status, "draft");

  // 门控函数直接覆盖
  eq("门控：失效+已确认→reconfirm", gateStatusByBatch("confirmed", true, false), "reconfirm");
  eq("门控：失效+草稿→paused", gateStatusByBatch("draft", false, false), "paused");
}

// ---------- 场景 3：两人同时提交复核，只过一份，后到者保留草稿与依据 ----------
{
  let core = seedIndoor(); // BP-12/I-07 已确认, version=1
  const before = core.records[recordId("BP-12", "I-07")];
  const t = Date.now();
  const r1 = submitReview(core, "BP-12", "I-07", {
    teacher: "王老师",
    basis: "核形态正常，染色均匀，与教材图一致",
    submittedAt: t,
    baseVersion: before.version,
  });
  ok("第一份复核通过", r1.ok, r1.message);
  core = r1.core;
  eq("通过者写入 approvedBy", core.records[before.id].approvedBy, "王老师");

  // 第二人仍基于旧版本同时提交
  const r2 = submitReview(core, "BP-12", "I-07", {
    teacher: "李老师",
    basis: "400x 下细胞壁完整（我的独立判断）",
    submittedAt: t + 1000,
    baseVersion: before.version,
  });
  ok("后到复核不通过", !r2.ok);
  const after = r2.core.records[before.id];
  const draft = after.reviews.find((r) => r.teacher === "李老师")!;
  eq("后到者保留为草稿状态", draft.state, "draft");
  ok("后到者依据完整保留", draft.basis.includes("细胞壁完整"));
  eq("通过者只有一位（王老师不被覆盖）", after.approvedBy, "王老师");
  eq("两份复核都留痕", after.reviews.length, 2);

  // 缺依据不能提交
  const noBasis = submitReview(core, "BP-12", "I-07", { teacher: "赵老师", basis: "  ", submittedAt: t + 2000, baseVersion: after.version });
  ok("无依据复核被拒", !noBasis.ok);
}

// ---------- 场景 4：合并异常隔离 + 可恢复，旧数据保留兼容 ----------
{
  let core = seedIndoor();
  const beforeJSON = JSON.stringify(core);

  // 高版本包：整包隔离，不动现有数据
  const rf = mergePack(core, futureSchemaPack());
  ok("高版本包被标记隔离", rf.report.quarantined);
  eq("产生 1 条异常", rf.core.anomalies.length, 1);
  eq("异常类型 unknown-schema", rf.core.anomalies[0].kind, "unknown-schema");
  ok("隔离不影响已有数据", JSON.stringify(rf.core.records) === JSON.stringify(core.records));
  ok("异常中完整保留原始包", rf.core.anomalies[0].pack.packId === "pack-future");
  core = rf.core;

  // 模拟升级后恢复
  const recovered = recoverAnomaly(core, core.anomalies[0].id, { force: true });
  ok("异常恢复成功", recovered.ok, recovered.message);
  core = recovered.core;
  ok("恢复后异常标记已解决", core.anomalies[0].resolved);
  eq("恢复后新玻片记录存在", !!core.records[recordId("BP-30", "I-99")], true);
  ok("旧记录仍在", !!core.records[recordId("BP-12", "I-07")]);

  // 实体冲突：批次方法不一致
  const rc = mergePack(core, conflictingBatchPack());
  eq("冲突产生异常", rc.core.anomalies.filter((a) => !a.resolved).length, 1);
  const conflict = rc.core.anomalies.find((a) => a.kind === "conflicting-entity")!;
  ok("冲突时室内原值不动", rc.core.batches["bat::I-07"].method === "碘液染色");
  eq("冲突 op 未被标记 applied", rc.report.applied.includes(conflict.opId!), false);
  core = rc.core;

  // 不允许静默恢复冲突
  const plain = recoverAnomaly(core, conflict.id);
  ok("冲突需显式确认，不能静默恢复", !plain.ok);
  const forced = recoverAnomaly(core, conflict.id, { force: true });
  ok("强制恢复成功", forced.ok, forced.message);
  ok("强制恢复仍保留室内侧染色方式", forced.core.batches["bat::I-07"].method === "碘液染色");
  ok("强制恢复后冲突标记已解决", forced.core.anomalies.find((a) => a.id === conflict.id)!.resolved);

  // 忽略路径：归档不删除
  const again = mergePack(forced.core, futureSchemaPack()); // 已 resolved，包再到仍会隔离新异常
  const ignored = dismissAnomaly(again.core, again.core.anomalies.filter((a) => !a.resolved)[0].id);
  ok("忽略操作成功", ignored.ok);
  ok("归档保留原始包", !!ignored.core.anomalies[0].pack);
  void beforeJSON;
}

// ---------- 场景 5：版本快照——看板/详情/导出同版，回滚不删旧数据 ----------
{
  let repo = createRepo(seedIndoor());
  let core = currentCore(repo);
  const merged = mergePack(core, offlinePackA());
  repo = commit(repo, merged.core, "断网恢复：合入 2 号镜台");
  eq("版本线 2 个版本", repo.versions.length, 2);

  const cur = currentCore(repo);
  const exported = JSON.parse(exportSnapshot(cur));
  eq("导出版本与当前一致", exported.schemaVersion, 3);
  eq("导出与看板同源：视野数 2", exported.records[0].fields.length, 2);

  // 回滚到初始版本
  const v0 = repo.versions[0];
  repo = rollback(repo, v0.id);
  const old = currentCore(repo);
  eq("回滚后只剩室内 1 个视野", old.records[recordId("BP-12", "I-07")].fields.length, 1);
  eq("回滚追加新版本而非删除", repo.versions.length, 3);
  ok("回滚后仍可再前进（旧版本都保留）", repo.versions.some((v) => v.label.includes("断网恢复")));

  // 再次提交一份操作（在回滚版本之上）
  const reMerged = mergePack(old, offlinePackB());
  repo = commit(repo, reMerged.core, "回滚后合入 5 号镜台");
  const recNow = currentCore(repo).records[recordId("BP-12", "I-07")];
  eq("回滚点之后新增视野并入", recNow.fields.length, 2); // 室内 400 + 新 200，A 包已从该分支消失
  ok("导出仍对应当前版本", exportSnapshot(currentCore(repo)).includes("砖形排列"));
}

// ---------- 场景 6：旧版本数据兼容迁移 ----------
{
  // 构造一个 v1 形态的旧库：字段缺失、没有 reviews/notes/alts
  const legacy = JSON.parse(JSON.stringify(emptyCore()));
  legacy.schemaVersion = 1;
  legacy.records["rec::BP-12::I-07"] = {
    id: "rec::BP-12::I-07",
    sampleCode: "S-001",
    slideCode: "BP-12",
    batchCode: "I-07",
    status: "confirmed",
    fields: [{ key: "400x@细胞核", magnification: "400x", structure: "细胞核", description: "旧描述" }],
  };
  const migrated = migrate(legacy as CoreState);
  const rec = migrated.records["rec::BP-12::I-07"];
  eq("迁移后 schema 升到当前", migrated.schemaVersion, 3);
  ok("旧记录打 compat 标记", rec.compat === true);
  eq("旧视野数据完整保留", rec.fields[0].description, "旧描述");
  eq("缺失字段补齐", Array.isArray(rec.reviews) && Array.isArray(rec.notes), true);
  // 迁移后可直接走统一合并管道
  const m = mergePack(migrated, offlinePackA());
  ok("旧数据迁移后能参与新合并", m.core.records["rec::BP-12::I-07"].fields.length === 2);
}

// ---------- 汇总 ----------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("失败项：\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("全部领域规则测试通过 ✓");
