import { useCore } from "../domain/store";
import { actions } from "../domain/store";
import { AnomalyKind } from "../domain/types";

const KIND_LABEL: Record<AnomalyKind, string> = {
  "unknown-schema": "高版本数据（暂不认识）",
  "conflicting-entity": "实体冲突（同批次不同染色方式）",
  "unresolved-ref": "引用缺失",
  malformed: "数据结构损坏",
};

export function AnomalyPanel() {
  const core = useCore();
  const anomalies = [...core.anomalies].reverse();

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>异常包整包/单条隔离，原始包完整保留；恢复时走同一合并管道，已应用操作幂等跳过</p>
          <h2>合并异常</h2>
        </div>
      </div>

      <div className="anomaly-list">
        {anomalies.length === 0 && <p className="empty">暂无异常。可点顶部「模拟高版本包 / 模拟冲突包」制造可恢复异常。</p>}
        {anomalies.map((a) => (
          <article key={a.id} className={`anomaly-card ${a.resolved ? "resolved" : ""}`}>
            <div className="anomaly-head">
              <span className={`status-pill ${a.resolved ? "st-confirmed" : "st-paused"}`}>
                {a.resolved ? "已处理" : "待处理"}
              </span>
              <h3>{KIND_LABEL[a.kind]}</h3>
              <small className="muted">
                包 {a.packId} · 设备 {a.pack.deviceId} · {a.pack.teacher} ·{" "}
                {new Date(a.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </small>
            </div>
            <p>{a.message}</p>
            {a.resolution && <p className="resolution">处理结果：{a.resolution}</p>}
            <details>
              <summary>查看保留的原始包（{a.pack.ops.length} 条操作，数据未删除）</summary>
              <pre>{JSON.stringify(a.pack, null, 2)}</pre>
            </details>
            {!a.resolved && (
              <div className="anomaly-actions">
                <button className="primary-action" onClick={() => actions.recoverAnomaly(a.id, false)}>
                  {a.kind === "unknown-schema" ? "升级后重新合入" : "尝试恢复合入"}
                </button>
                <button className="ghost" onClick={() => actions.recoverAnomaly(a.id, true)}>
                  强制恢复（旧数据保留，冲突以室内侧为准）
                </button>
                <button className="ghost" onClick={() => actions.dismissAnomaly(a.id)}>
                  归档忽略（保留原始包）
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
