import { useMemo, useState, useSyncExternalStore } from "react";
import "./styles.css";
import {
  discardDraft,
  getState,
  invalidateBatch,
  mergeOutbox,
  registerObservation,
  resetDemo,
  resubmitDraft,
  restoreBatch,
  rollbackToSnapshot,
  setOnline,
  submitReview,
  subscribe,
} from "./domain/store";
import {
  AppState,
  Observation,
  ORIGIN_LABEL,
  STATUS_LABEL,
  ViewInput,
  fmtTime,
} from "./domain/types";

const SAMPLE_TYPES = ["植物组织", "动物组织", "微生物", "血液涂片"];
const MAGNIFICATIONS = ["100x", "200x", "400x", "1000x"];
const REVIEWERS = ["王老师", "李老师"];
const ROLES = ["实验课教师", "学生", "实验管理员"];

function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

type Joins = {
  sampleById: Map<string, AppState["samples"][number]>;
  slideById: Map<string, AppState["slides"][number]>;
  batchById: Map<string, AppState["batches"][number]>;
};

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  const statusColors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function VersionPill({ state }: { state: AppState }) {
  return (
    <span className="version-pill">
      数据版本 v{state.schemaVersion} · 修订 r{state.dataRevision}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 登记区
// ---------------------------------------------------------------------------

function RegisterForm({ state }: { state: AppState }) {
  const [sampleName, setSampleName] = useState("");
  const [sampleType, setSampleType] = useState(SAMPLE_TYPES[0]);
  const [slideLabel, setSlideLabel] = useState("");
  const [stain, setStain] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [note, setNote] = useState("");
  const [createdBy, setCreatedBy] = useState(REVIEWERS[0]);
  const [views, setViews] = useState<ViewInput[]>([{ magnification: "400x", structure: "", note: "" }]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const activeBatches = state.batches.filter((b) => b.status === "active");

  function updateView(index: number, patch: Partial<ViewInput>) {
    setViews((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function submit() {
    if (!sampleName.trim() || !slideLabel.trim() || !stain.trim() || !lotNo.trim()) {
      setMsg({ kind: "err", text: "请填写样本名称、玻片编号、染色方式与批次号" });
      return;
    }
    const usableViews = views.filter((v) => v.structure.trim());
    if (usableViews.length === 0) {
      setMsg({ kind: "err", text: "请至少填写一个观察视野（观察结构必填）" });
      return;
    }
    const err = registerObservation({
      sampleName,
      sampleType,
      slideLabel,
      batch: { stain, lotNo },
      note,
      views: usableViews,
      createdBy,
    });
    if (err) {
      setMsg({ kind: "err", text: err });
      return;
    }
    setMsg({
      kind: "ok",
      text: state.online ? "已登记到室内记录" : "已加入离线队列，网络恢复后可合并",
    });
    setSlideLabel("");
    setNote("");
    setViews([{ magnification: "400x", structure: "", note: "" }]);
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>生物显微观察</p>
          <h2>登记样本 · 染色批次 · 观察视野</h2>
        </div>
        <button className="primary-action" onClick={submit}>
          {state.online ? "登记到室内记录" : "断网中 · 加入离线队列"}
        </button>
      </div>

      <div className="field-grid">
        <label>
          <span>样本名称</span>
          <input value={sampleName} onChange={(e) => setSampleName(e.target.value)} placeholder="如：洋葱表皮" />
        </label>
        <label>
          <span>样本类型</span>
          <select value={sampleType} onChange={(e) => setSampleType(e.target.value)}>
            {SAMPLE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span>玻片编号</span>
          <input value={slideLabel} onChange={(e) => setSlideLabel(e.target.value)} placeholder="如：SL-101" />
        </label>
        <label>
          <span>登记人</span>
          <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
            {REVIEWERS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          <span>染色方式</span>
          <input value={stain} onChange={(e) => setStain(e.target.value)} placeholder="如：碘液" />
        </label>
        <label>
          <span>批次号</span>
          <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="如：2026-09-A" />
        </label>
      </div>

      {activeBatches.length > 0 && (
        <div className="chips quick-pick">
          {activeBatches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setStain(b.stain);
                setLotNo(b.lotNo);
              }}
            >
              {b.stain}·{b.lotNo}
            </button>
          ))}
        </div>
      )}

      <label>
        <span>记录备注</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="整条记录的备注（合并时先登内容优先保留）" />
      </label>

      <h3 className="sub-heading">观察视野（可多个）</h3>
      {views.map((view, index) => (
        <div className="view-row" key={index}>
          <select value={view.magnification} onChange={(e) => updateView(index, { magnification: e.target.value })}>
            {MAGNIFICATIONS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            value={view.structure}
            onChange={(e) => updateView(index, { structure: e.target.value })}
            placeholder="观察结构，如：细胞核"
          />
          <input
            value={view.note}
            onChange={(e) => updateView(index, { note: e.target.value })}
            placeholder="视野描述"
          />
          <button
            type="button"
            aria-label="删除视野"
            disabled={views.length === 1}
            onClick={() => setViews((rows) => rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="form-actions">
        <button
          type="button"
          onClick={() => setViews((rows) => [...rows, { magnification: "400x", structure: "", note: "" }])}
        >
          + 添加视野
        </button>
        {msg && <span className={msg.kind === "err" ? "error-text" : "ok-text"}>{msg.text}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 离线队列与合并中心
// ---------------------------------------------------------------------------

function MergeCenter({ state }: { state: AppState }) {
  const latestSnapshot = state.snapshots[0];
  const errorCount = state.outbox.filter((e) => e.lastError).length;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>断网登记 · 网络恢复后合并</p>
          <h2>离线队列与合并</h2>
        </div>
        <div className="toolbar">
          <button
            className="primary-action"
            disabled={!state.online || state.outbox.length === 0}
            onClick={mergeOutbox}
          >
            {errorCount > 0 ? "重试合并" : "合并到室内记录"}
          </button>
          <button
            disabled={!latestSnapshot}
            title={latestSnapshot ? latestSnapshot.label : "暂无快照"}
            onClick={() => latestSnapshot && rollbackToSnapshot(latestSnapshot.id)}
          >
            回滚到合并前
          </button>
        </div>
      </div>

      {!state.online && <p className="banner warn">当前断网：新登记进入离线队列，网络恢复后在此合并。</p>}
      {errorCount > 0 && (
        <p className="banner danger">
          合并出现异常：{errorCount} 条登记暂挂。可恢复失效的染色批次后重试，或回滚到合并前快照。
        </p>
      )}

      {state.outbox.length === 0 ? (
        <p className="empty">离线队列为空。</p>
      ) : (
        <div className="outbox-list">
          {state.outbox.map((entry) => (
            <article key={entry.id} className={`outbox-item${entry.lastError ? " has-error" : ""}`}>
              <strong>
                {entry.payload.sampleName} / {entry.payload.slideLabel}
              </strong>
              <span>
                {entry.payload.batch.stain}·{entry.payload.batch.lotNo} · {entry.payload.views.length} 个视野 ·{" "}
                {entry.queuedBy} · {fmtTime(entry.queuedAt)}
              </span>
              {entry.lastError && <em>{entry.lastError}</em>}
            </article>
          ))}
        </div>
      )}

      <h3 className="sub-heading">合并与操作日志</h3>
      <ul className="log-list">
        {state.mergeLog.slice(0, 12).map((e) => (
          <li key={e.id} className={`log-${e.kind}`}>
            <time>{fmtTime(e.at)}</time>
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 复核区（两人同时提交只通过一份，后到者保留草稿与依据）
// ---------------------------------------------------------------------------

function ReviewBox({ obs, baseRevision }: { obs: Observation; baseRevision: number }) {
  const [reviewer, setReviewer] = useState(REVIEWERS[0]);
  const [rationale, setRationale] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const paused = obs.status === "paused";

  return (
    <div className="review-box">
      <h3>复核</h3>
      <p className="hint">
        本次提交基于打开详情时的修订 r{baseRevision}
        ；若他人已先通过，你的提交不会覆盖记录，草稿与依据将保留在下方。
      </p>
      <div className="review-row">
        <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          {REVIEWERS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="复核依据（结论与理由）"
        />
        <button
          className="primary-action"
          disabled={paused}
          onClick={() => {
            const err = submitReview(obs.id, reviewer, rationale, baseRevision);
            setMsg(err ?? `复核已通过（${reviewer}）`);
            if (!err) setRationale("");
          }}
        >
          提交复核
        </button>
      </div>
      {paused && <p className="error-text">草稿已暂停（染色批次失效），暂不能复核。</p>}
      {msg && <p className={msg.includes("冲突") || msg.includes("暂停") ? "error-text" : "ok-text"}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 详情
// ---------------------------------------------------------------------------

function DetailPanel({ state, joins, obs }: { state: AppState; joins: Joins; obs: Observation }) {
  // 打开详情时快照状态：模拟两位复核人同时基于同一版本工作
  const [opened] = useState(() => ({ status: obs.status, revision: obs.revision }));

  const slide = joins.slideById.get(obs.slideId);
  const sample = slide ? joins.sampleById.get(slide.sampleId) : undefined;
  const batch = joins.batchById.get(obs.batchId);
  if (!slide || !sample || !batch) return null;

  const drafts = state.reviewDrafts.filter((d) => d.obsId === obs.id);
  const showReviewBox = opened.status === "draft" || opened.status === "reconfirm";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>观察记录详情</p>
          <h2>
            {sample.name} · {slide.label}
          </h2>
        </div>
        <VersionPill state={state} />
      </div>

      <div className="detail-grid">
        <div className="cell">
          <span>样本</span>
          {sample.name}（{sample.type}）
        </div>
        <div className="cell">
          <span>染色批次</span>
          {batch.stain} · {batch.lotNo}{" "}
          {batch.status === "invalid" && <span className="badge badge-invalid">已失效</span>}
        </div>
        <div className="cell">
          <span>状态</span>
          <span className={`badge badge-${obs.status}`}>{STATUS_LABEL[obs.status]}</span>
        </div>
        <div className="cell">
          <span>来源</span>
          {ORIGIN_LABEL[obs.origin]}
        </div>
        <div className="cell">
          <span>修订</span>r{obs.revision}
        </div>
        <div className="cell">
          <span>最近更新</span>
          {fmtTime(obs.updatedAt)}
        </div>
      </div>

      {obs.note && <p className="note-line">备注:{obs.note}</p>}
      {obs.status === "reconfirm" && (
        <p className="banner warn">染色批次曾失效，这条已确认观察需要重新确认。</p>
      )}
      {obs.status === "paused" && (
        <p className="banner warn">染色批次已失效，未完成草稿先停住；批次恢复后可继续。</p>
      )}

      <h3 className="sub-heading">观察视野（{obs.views.length}）</h3>
      <table className="view-table">
        <thead>
          <tr>
            <th>放大倍数</th>
            <th>观察结构</th>
            <th>视野描述</th>
            <th>登记人</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          {obs.views.map((v) => (
            <tr key={v.id}>
              <td>{v.magnification}</td>
              <td>{v.structure}</td>
              <td>{v.note || "—"}</td>
              <td>{v.createdBy}</td>
              <td>{ORIGIN_LABEL[v.origin]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {obs.review && (
        <div className="review-info">
          <strong>
            复核通过：{obs.review.reviewer} · {fmtTime(obs.review.at)}
          </strong>
          <p>依据：{obs.review.rationale}</p>
        </div>
      )}

      {showReviewBox && <ReviewBox obs={obs} baseRevision={opened.revision} />}

      {drafts.length > 0 && (
        <div className="kept-drafts">
          <h3 className="sub-heading">保留的复核草稿</h3>
          {drafts.map((d) => (
            <article key={d.id} className="kept-draft">
              <strong>{d.reviewer}</strong>
              <time>{fmtTime(d.keptAt)}</time>
              <p>依据：{d.rationale}</p>
              <p className="reason">{d.reason}</p>
              <div className="toolbar">
                <button
                  onClick={() => {
                    const err = resubmitDraft(d.id);
                    if (err) window.alert(err);
                  }}
                >
                  按当前版本重新提交
                </button>
                <button onClick={() => discardDraft(d.id)}>丢弃</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="version-foot">看板、详情与导出均基于同一数据版本（v{state.schemaVersion} · r{state.dataRevision}）。</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

function exportJson(state: AppState) {
  const payload = {
    schemaVersion: state.schemaVersion,
    dataRevision: state.dataRevision,
    exportedAt: new Date().toISOString(),
    samples: state.samples,
    slides: state.slides,
    batches: state.batches,
    observations: state.observations,
    reviewDrafts: state.reviewDrafts,
    mergeLog: state.mergeLog,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hxwl06-v${payload.schemaVersion}-r${payload.dataRevision}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// 主界面
// ---------------------------------------------------------------------------

export default function App() {
  const state = useAppState();
  const [filter, setFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const joins = useMemo<Joins>(
    () => ({
      sampleById: new Map(state.samples.map((s) => [s.id, s])),
      slideById: new Map(state.slides.map((s) => [s.id, s])),
      batchById: new Map(state.batches.map((b) => [b.id, b])),
    }),
    [state.samples, state.slides, state.batches]
  );

  const totalViews = state.observations.reduce((n, o) => n + o.views.length, 0);
  const activeBatches = state.batches.filter((b) => b.status === "active").length;
  const pending = state.observations.filter((o) => o.status === "draft" || o.status === "reconfirm").length;
  const pausedCount = state.observations.filter((o) => o.status === "paused").length;

  const metrics = [
    { label: "样本数", value: String(state.samples.length) },
    { label: "视野记录", value: String(totalViews) },
    { label: "有效染色批次", value: `${activeBatches}/${state.batches.length}` },
    { label: "待复核·重确认", value: pausedCount > 0 ? `${pending}（暂停 ${pausedCount}）` : String(pending) },
  ];

  const records = state.observations
    .filter((o) => {
      if (filter === "全部") return true;
      const slide = joins.slideById.get(o.slideId);
      const sample = slide ? joins.sampleById.get(slide.sampleId) : undefined;
      return sample?.type === filter;
    })
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const selected = state.observations.find((o) => o.id === selectedId) ?? null;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · port 5106</p>
          <h1>显微镜玻片观察</h1>
          <p className="subtitle">
            样本、多倍率视野与染色观察记录库：断网登记、恢复合并、批次失效处理与复核冲突保护
          </p>
        </div>
        <div className="stack-card">
          <span>运行状态</span>
          <div className="status-lines">
            <span className={`net-badge ${state.online ? "online" : "offline"}`}>
              {state.online ? "● 在线" : "● 断网"}
            </span>
            <VersionPill state={state} />
            <span className="compat-note">
              旧版数据：{state.legacyArchive ? "已保留并兼容迁移" : "无"}
            </span>
          </div>
          <div className="toolbar">
            <button onClick={() => setOnline(!state.online)}>
              {state.online ? "模拟断网" : "恢复网络"}
            </button>
            <button
              onClick={() => {
                if (window.confirm("重置将清空本地演示数据并恢复初始状态，确定？")) resetDemo();
              }}
            >
              重置演示数据
            </button>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, index) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {ROLES.map((role) => (
              <span key={role}>{role}</span>
            ))}
          </div>
          <h2>筛选</h2>
          <div className="chips muted">
            {["全部", ...SAMPLE_TYPES].map((t) => (
              <button key={t} className={filter === t ? "active" : ""} onClick={() => setFilter(t)}>
                {t}
              </button>
            ))}
          </div>
          <h2>染色批次</h2>
          <div className="batch-list">
            {state.batches.map((b) => (
              <div key={b.id} className={`batch-item${b.status === "invalid" ? " invalid" : ""}`}>
                <div>
                  <strong>{b.stain}</strong>
                  <span>
                    批号 {b.lotNo} · {b.status === "invalid" ? "已失效" : "有效"}
                  </span>
                </div>
                {b.status === "active" ? (
                  <button onClick={() => invalidateBatch(b.id)}>设为失效</button>
                ) : (
                  <button onClick={() => restoreBatch(b.id)}>恢复</button>
                )}
              </div>
            ))}
          </div>
        </aside>

        <RegisterForm state={state} />
      </section>

      <MergeCenter state={state} />

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>同一玻片同一批次一条记录</p>
            <h2>观察记录（{records.length}）</h2>
          </div>
          <VersionPill state={state} />
        </div>
        <div className="record-list">
          {records.map((obs, index) => {
            const slide = joins.slideById.get(obs.slideId);
            const sample = slide ? joins.sampleById.get(slide.sampleId) : undefined;
            const batch = joins.batchById.get(obs.batchId);
            if (!slide || !sample || !batch) return null;
            return (
              <article
                key={obs.id}
                className={`record-card selectable${selectedId === obs.id ? " selected" : ""}`}
                onClick={() => setSelectedId(obs.id)}
              >
                <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <h3>
                    {sample.name} · {slide.label}
                  </h3>
                  <p>
                    {batch.stain}·{batch.lotNo} · {obs.views.length} 个视野 · 更新 {fmtTime(obs.updatedAt)}
                  </p>
                  <p className="badges">
                    <span className={`badge badge-${obs.status}`}>{STATUS_LABEL[obs.status]}</span>
                    <span className="badge badge-origin">{ORIGIN_LABEL[obs.origin]}</span>
                    {batch.status === "invalid" && <span className="badge badge-invalid">批次失效</span>}
                    <span className="badge badge-origin">r{obs.revision}</span>
                  </p>
                </div>
              </article>
            );
          })}
          {records.length === 0 && <p className="empty">当前筛选下暂无记录。</p>}
        </div>
      </section>

      {selected && <DetailPanel key={selected.id} state={state} joins={joins} obs={selected} />}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>与看板、详情同一版本</p>
            <h2>导出</h2>
          </div>
          <button className="primary-action" onClick={() => exportJson(state)}>
            导出 JSON
          </button>
        </div>
        <p className="export-summary">
          <VersionPill state={state} /> · 样本 {state.samples.length} · 观察记录{" "}
          {state.observations.length} · 视野 {totalViews} · 保留复核草稿 {state.reviewDrafts.length} ·
          日志 {state.mergeLog.length} 条
        </p>
      </section>
    </main>
  );
}
