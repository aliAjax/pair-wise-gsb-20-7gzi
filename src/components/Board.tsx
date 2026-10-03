import { useCore } from "../domain/store";
import { ObservationRecord } from "../domain/types";
import { STATUS_LABEL } from "../domain/versions";

const STATUS_CLASS: Record<ObservationRecord["status"], string> = {
  draft: "st-draft",
  confirmed: "st-confirmed",
  reconfirm: "st-reconfirm",
  paused: "st-paused",
};

export function Board({ onOpen }: { onOpen: (slideCode: string, batchCode: string) => void }) {
  const core = useCore();
  const records = Object.values(core.records).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="panel records">
      <div className="section-heading">
        <div>
          <p>同一玻片 + 同一染色批次 = 一条记录（多视野归并）</p>
          <h2>观察记录看板</h2>
        </div>
      </div>
      <div className="board-list">
        {records.map((r) => {
          const sample = core.samples[r.sampleId];
          const batch = core.batches[r.batchId];
          const blocked = r.fields.reduce((n, f) => n + f.alternates.length, 0);
          const draftReviews = r.reviews.filter((rv) => rv.state === "draft").length;
          return (
            <article key={r.id} className="record-card clickable" onClick={() => onOpen(r.slideCode, r.batchCode)}>
              <div className="record-index">
                <span className={`status-pill ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="record-main">
                <h3>
                  玻片 {r.slideCode} <small>批次 {r.batchCode} · {batch?.method ?? "?"}</small>
                </h3>
                <p>
                  {sample?.name ?? r.sampleCode}（{sample?.category ?? "—"}） · {r.fields.length} 个视野
                  {" · "}
                  复核 {r.reviews.filter((x) => x.state === "accepted").length} 通过
                  {draftReviews > 0 && <em className="warn-inline"> · {draftReviews} 份并发草稿</em>}
                  {blocked > 0 && <em className="warn-inline"> · {blocked} 处后到内容留档未覆盖</em>}
                </p>
                <div className="field-chips">
                  {r.fields.map((f) => (
                    <span key={f.fieldId} className="field-chip" title={f.description}>
                      {f.magnification} · {f.structure}
                      {f.sources.length > 1 && <i>×{f.sources.length}</i>}
                    </span>
                  ))}
                </div>
              </div>
              <div className="record-meta">
                <span>v{r.version}</span>
                <span>{new Date(r.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</span>
              </div>
            </article>
          );
        })}
        {records.length === 0 && <p className="empty">暂无记录，去「登记」或使用顶部模拟按钮。</p>}
      </div>
    </section>
  );
}
