import { actions, useCore, useStore } from "../domain/store";
import { exportSnapshot } from "../domain/versions";

export function VersionPanel() {
  const store = useStore();
  const core = useCore();
  const versions = [...store.repo.versions].map((v, i) => ({ v, index: i + 1 })).reverse();

  const download = () => {
    const blob = new Blob([exportSnapshot(core)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `观察导出-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>看板、详情、导出始终读取当前版本指针指向的同一份快照；回滚是追加新版本，旧数据全部保留</p>
          <h2>版本线与导出</h2>
        </div>
        <button className="primary-action" onClick={download}>导出当前版本 JSON</button>
      </div>

      <ol className="version-list">
        {versions.map(({ v, index }) => {
          const current = v.id === store.repo.currentVersionId;
          const recCount = Object.keys(v.core.records).length;
          const fieldCount = Object.values(v.core.records).reduce((n, r) => n + r.fields.length, 0);
          const anomalyCount = v.core.anomalies.length;
          return (
            <li key={v.id} className={current ? "current" : ""}>
              <div className="version-main">
                <strong>#{index} {v.label}</strong>
                {current && <span className="status-pill st-confirmed">看板/详情/导出正在展示</span>}
                <small className="muted">{new Date(v.at).toLocaleString("zh-CN", { hour12: false })}</small>
              </div>
              <div className="version-stats">
                <span>{recCount} 记录</span>
                <span>{fieldCount} 视野</span>
                <span>{anomalyCount} 异常</span>
                {!current && (
                  <button className="ghost small" onClick={() => actions.rollback(v.id)}>
                    回到此版本（保留后续版本）
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
