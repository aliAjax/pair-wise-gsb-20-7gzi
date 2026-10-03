import { useState } from "react";
import "./styles.css";
import { actions, useCore, useStore } from "./domain/store";
import { Board } from "./components/Board";
import { RegisterForm } from "./components/RegisterForm";
import { BatchPanel } from "./components/BatchPanel";
import { AnomalyPanel } from "./components/AnomalyPanel";
import { VersionPanel } from "./components/VersionPanel";
import { RecordModal } from "./components/RecordModal";
import { exportSnapshot } from "./domain/versions";
import { recordId } from "./domain/merge";
import {
  conflictingBatchPack,
  futureSchemaPack,
  offlinePackA,
  offlinePackB,
} from "./domain/seed";

const TABS = [
  { key: "board", label: "看板" },
  { key: "register", label: "登记" },
  { key: "batch", label: "染色批次" },
  { key: "anomaly", label: "合并异常" },
  { key: "version", label: "版本与导出" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const store = useStore();
  const core = useCore();
  const [tab, setTab] = useState<TabKey>("board");
  const [selected, setSelected] = useState<{ slideCode: string; batchCode: string } | null>(null);

  const recCount = Object.keys(core.records).length;
  const fieldCount = Object.values(core.records).reduce((n, r) => n + r.fields.length, 0);
  const openAnomalies = core.anomalies.filter((a) => !a.resolved).length;
  const needReview = Object.values(core.records).filter((r) => r.status === "reconfirm").length;

  const doExport = () => {
    const blob = new Blob([exportSnapshot(core)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `观察导出-v${store.repo.versions.length}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const demoConcurrent = () => {
    // 两名教师基于同一版本同时点"复核通过"
    const target = Object.values(core.records).find((r) => r.status === "confirmed");
    if (!target) return;
    const base = core.records[recordId(target.slideCode, target.batchCode)].version;
    actions.submitReview(target.slideCode, target.batchCode, {
      teacher: "王老师",
      basis: "核形态正常、染色均匀，与教材图谱一致",
      baseVersion: base,
    });
    setTimeout(() => {
      actions.submitReview(target.slideCode, target.batchCode, {
        teacher: "李老师",
        basis: "细胞壁完整、未见破损（我的独立观察依据）",
        baseVersion: base,
      });
    }, 50);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · 离线优先显微观察记录</p>
          <h1>显微镜玻片观察</h1>
          <p className="subtitle">断网登记 → 恢复合并（同玻片同批次视野归并、后到不覆盖） · 批次失效 · 并发复核 · 版本同源</p>
        </div>
        <div className="hero-actions">
          <label className={`net-switch ${store.online ? "on" : "off"}`}>
            <input
              type="checkbox"
              checked={store.online}
              onChange={(e) => actions.setOnline(e.target.checked)}
            />
            <span className="dot" />
            {store.online ? "在线" : "断网中"}
          </label>
          {store.queue.length > 0 && (
            <button className="primary-action" onClick={actions.flushQueue}>
              网络恢复 · 合并队列（{store.queue.length}）
            </button>
          )}
          <button onClick={doExport}>按当前版本导出</button>
          <button className="ghost" onClick={actions.resetAll}>重置演示</button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>观察记录</span>
          <strong>{recCount}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>视野（已归并）</span>
          <strong>{fieldCount}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>待重新确认</span>
          <strong>{needReview}</strong>
          <i className={needReview ? "status-danger" : "status-ok"} />
        </article>
        <article className="metric-card">
          <span>未处理异常</span>
          <strong>{openAnomalies}</strong>
          <i className={openAnomalies ? "status-danger" : "status-ok"} />
        </article>
        <article className="metric-card">
          <span>离线队列</span>
          <strong>{store.queue.length}</strong>
          <i className={store.queue.length ? "status-watch" : "status-ok"} />
        </article>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "anomaly" && openAnomalies > 0 && <em className="badge">{openAnomalies}</em>}
          </button>
        ))}
        <span className="tab-spacer" />
        <button className="ghost small" onClick={() => actions.enqueuePack(offlinePackA(), "2号镜台：同玻片重复400x+新增1000x")}>
          模拟2号台登记
        </button>
        <button className="ghost small" onClick={() => actions.enqueuePack(offlinePackB(), "5号镜台：同玻片新增200x")}>
          模拟5号台登记
        </button>
        <button className="ghost small" onClick={() => actions.enqueuePack(futureSchemaPack(), "高版本数据包")}>
          模拟高版本包
        </button>
        <button className="ghost small" onClick={() => actions.enqueuePack(conflictingBatchPack(), "批次方法冲突包")}>
          模拟冲突包
        </button>
        <button className="ghost small" onClick={demoConcurrent}>
          双师同时复核
        </button>
      </nav>

      {tab === "board" && <Board onOpen={(s, b) => setSelected({ slideCode: s, batchCode: b })} />}
      {tab === "register" && <RegisterForm />}
      {tab === "batch" && <BatchPanel />}
      {tab === "anomaly" && <AnomalyPanel />}
      {tab === "version" && <VersionPanel />}

      {selected && (
        <RecordModal
          slideCode={selected.slideCode}
          batchCode={selected.batchCode}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="toast-stack">
        {store.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </main>
  );
}
