import { useState } from "react";
import { actions, useCore } from "../domain/store";
import { STATUS_LABEL } from "../domain/versions";
import { recordId } from "../domain/merge";

export function RecordModal({
  slideCode,
  batchCode,
  onClose,
}: {
  slideCode: string;
  batchCode: string;
  onClose: () => void;
}) {
  const core = useCore();
  const rec = core.records[recordId(slideCode, batchCode)];
  const [teacher, setTeacher] = useState("王老师");
  const [basis, setBasis] = useState("");

  if (!rec) return null;
  const batch = core.batches[rec.batchId];
  const sample = core.samples[rec.sampleId];
  const canReview = rec.status === "confirmed";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p className="eyebrow">记录详情（与看板/导出同一版本）</p>
            <h2>
              玻片 {rec.slideCode} · 批次 {rec.batchCode}
              <span className={`status-pill st-${rec.status}`}>{STATUS_LABEL[rec.status]}</span>
            </h2>
            <p className="muted">
              {sample?.name}（{sample?.category}） · {batch?.method} · 记录版本 v{rec.version}
              {rec.compat && <em className="warn-inline"> · 旧版本数据兼容迁入</em>}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>关闭</button>
        </header>

        <section>
          <h3>观察视野（{rec.fields.length}）</h3>
          {rec.fields.map((f) => (
            <div key={f.fieldId} className="field-detail">
              <div className="field-detail-head">
                <strong>{f.magnification} · {f.structure}</strong>
                <span className="muted">{f.sources.length} 次登记归并</span>
              </div>
              <p className="canonical">当前值：{f.description || "（未填写描述）"}</p>
              <ul className="source-list">
                {f.sources.map((s, i) => (
                  <li key={`${s.clientOpId}-${i}`}>
                    {s.deviceId === "indoor" ? "室内记录台" : s.deviceId} · {s.teacher} ·{" "}
                    {new Date(s.observedAt).toLocaleString("zh-CN", { hour12: false })}
                  </li>
                ))}
              </ul>
              {f.alternates.length > 0 && (
                <div className="alternates">
                  <h4>被保留的后到内容（未覆盖原值）</h4>
                  {f.alternates.map((alt, i) => (
                    <p key={i} className="alt-item">
                      「{alt.description}」
                      <small> — {alt.source.teacher} / {alt.source.deviceId} / {new Date(alt.source.observedAt).toLocaleString("zh-CN", { hour12: false })}</small>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>

        <section>
          <h3>复核（同一时刻只通过一份，后到者保留草稿与依据）</h3>
          {rec.reviews.length === 0 && <p className="muted">暂无复核</p>}
          <ul className="review-list">
            {rec.reviews.map((rv) => (
              <li key={rv.id} className={rv.state === "accepted" ? "accepted" : "draft"}>
                <span className={`status-pill ${rv.state === "accepted" ? "st-confirmed" : "st-draft"}`}>
                  {rv.state === "accepted" ? "已通过" : "保留草稿"}
                </span>
                <strong>{rv.teacher}</strong>
                <span>依据：{rv.basis}</span>
                <small className="muted">{new Date(rv.submittedAt).toLocaleString("zh-CN", { hour12: false })} · 基于 v{rv.recordVersion}</small>
                {rv.rejectReason && <p className="reject-reason">{rv.rejectReason}</p>}
              </li>
            ))}
          </ul>

          <div className="review-form">
            <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="复核教师" />
            <input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="复核依据（必填），如：核形态、染色均匀度、与图谱比对"
            />
            <button
              className="primary-action"
              disabled={!canReview}
              title={canReview ? "" : STATUS_LABEL[rec.status] + " 状态不可复核"}
              onClick={() => {
                actions.submitReview(slideCode, batchCode, { teacher, basis, baseVersion: rec.version });
                setBasis("");
              }}
            >
              提交复核通过
            </button>
          </div>
          {!canReview && <p className="hint">当前状态「{STATUS_LABEL[rec.status]}」不可复核：批次失效后需教师先重新确认，草稿需先确认。</p>}
        </section>

        <section>
          <h3>审计留痕</h3>
          <ul className="audit-list">
            {[...rec.notes].reverse().map((n, i) => (
              <li key={i}>
                <small className="muted">{new Date(n.at).toLocaleString("zh-CN", { hour12: false })}</small>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
