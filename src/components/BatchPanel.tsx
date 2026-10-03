import { useState } from "react";
import { actions, useCore } from "../domain/store";

export function BatchPanel() {
  const core = useCore();
  const [reason, setReason] = useState("染色试剂过期");

  const batches = Object.values(core.batches).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>批次失效后：已确认观察转「待重新确认」，未完成草稿「停住」</p>
          <h2>染色批次</h2>
        </div>
      </div>

      <div className="batch-list">
        {batches.map((b) => {
          const recs = Object.values(core.records).filter((r) => r.batchId === b.id);
          return (
            <article key={b.id} className="batch-card">
              <div className="batch-head">
                <div>
                  <h3>
                    批次 {b.code} · {b.method}
                    <span className={`status-pill ${b.status === "active" ? "st-confirmed" : "st-paused"}`}>
                      {b.status === "active" ? "有效" : "已失效"}
                    </span>
                    {b.origin === "offline" && <small className="origin-tag">离线并入</small>}
                  </h3>
                  {b.status === "invalid" && (
                    <p className="muted">
                      失效原因：{b.invalidReason} · {new Date(b.invalidAt!).toLocaleString("zh-CN", { hour12: false })}
                    </p>
                  )}
                </div>
                {b.status === "active" && (
                  <div className="invalidate-row">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="失效原因" />
                    <button className="danger-action" onClick={() => actions.invalidateBatch(b.code, reason)}>
                      标记批次失效
                    </button>
                  </div>
                )}
                {b.status === "invalid" && (
                  <button className="ghost" onClick={() => actions.restoreBatch(b.code)}>
                    恢复批次有效（换试剂后）
                  </button>
                )}
              </div>

              <ul className="batch-records">
                {recs.map((r) => (
                  <li key={r.id}>
                    <span>玻片 {r.slideCode}</span>
                    <span className={`status-pill st-${r.status}`}>
                      {r.status === "confirmed" ? "已确认" : r.status === "draft" ? "草稿" : r.status === "reconfirm" ? "待重新确认" : "停住"}
                    </span>
                    {r.status === "reconfirm" && (
                      <button className="small primary-action" onClick={() => actions.reconfirm(r.slideCode, r.batchCode, "王老师")}>
                        重新确认
                      </button>
                    )}
                    {r.status === "paused" && (
                      <button className="small ghost" title="批次恢复有效后可继续" onClick={() => actions.resume(r.slideCode, r.batchCode)}>
                        尝试继续草稿
                      </button>
                    )}
                    {r.lastReconfirmedAt && (
                      <small className="muted">复认于 {new Date(r.lastReconfirmedAt).toLocaleTimeString("zh-CN", { hour12: false })}</small>
                    )}
                  </li>
                ))}
                {recs.length === 0 && <li className="muted">该批次下暂无观察记录</li>}
              </ul>
            </article>
          );
        })}
      </div>
      <p className="hint">
        说明：批次失效只做状态门控，数据不删。点击「恢复批次有效」模拟更换合格试剂后，「待重新确认」记录由教师复认回到已确认，「停住」草稿可点「尝试继续草稿」恢复。
      </p>
    </section>
  );
}
