import { FormEvent, useState } from "react";
import { actions, useStore } from "../domain/store";

interface Row {
  magnification: string;
  structure: string;
  description: string;
}

export function RegisterForm() {
  const { online, queue } = useStore();
  const [teacher, setTeacher] = useState("王老师");
  const [deviceId, setDeviceId] = useState("scope-table-02");
  const [sampleCode, setSampleCode] = useState("S-001");
  const [sampleName, setSampleName] = useState("洋葱表皮");
  const [category, setCategory] = useState("植物组织");
  const [slideCode, setSlideCode] = useState("BP-12");
  const [batchCode, setBatchCode] = useState("I-07");
  const [method, setMethod] = useState("碘液染色");
  const [confirmed, setConfirmed] = useState(true);
  const [rows, setRows] = useState<Row[]>([
    { magnification: "400x", structure: "细胞核", description: "" },
  ]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = rows.filter((r) => r.magnification.trim() && r.structure.trim());
    if (!sampleCode.trim() || !slideCode.trim() || !batchCode.trim() || fields.length === 0) return;
    actions.register({
      teacher,
      deviceId,
      sampleCode,
      sampleName,
      category,
      slideCode,
      batchCode,
      method,
      fields,
      status: confirmed ? "confirmed" : "draft",
    });
    setRows([{ magnification: "", structure: "", description: "" }]);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>{online ? "在线：登记立即与室内记录合并" : "断网：登记保存到本地队列，恢复后按顺序合并"}</p>
          <h2>教师登记 · 样本 / 染色批次 / 观察视野</h2>
        </div>
        <span className={`net-badge ${online ? "on" : "off"}`}>{online ? "在线" : `离线队列 ${queue.length}`}</span>
      </div>

      <form className="register-form" onSubmit={submit}>
        <div className="form-grid">
          <label><span>教师</span><input value={teacher} onChange={(e) => setTeacher(e.target.value)} /></label>
          <label><span>镜台设备号</span><input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></label>
          <label><span>样本编号</span><input value={sampleCode} onChange={(e) => setSampleCode(e.target.value)} /></label>
          <label><span>样本名称</span><input value={sampleName} onChange={(e) => setSampleName(e.target.value)} /></label>
          <label>
            <span>样本类型</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {["植物组织", "动物组织", "微生物", "血液涂片"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label><span>玻片编号</span><input value={slideCode} onChange={(e) => setSlideCode(e.target.value)} /></label>
          <label><span>染色批次号</span><input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} /></label>
          <label><span>染色方式</span><input value={method} onChange={(e) => setMethod(e.target.value)} /></label>
        </div>

        <h3 className="form-sub">观察视野（同一玻片+批次可多个，重复视野自动归并）</h3>
        <div className="field-rows">
          <div className="field-row head">
            <span>放大倍数</span><span>观察结构</span><span>视野描述</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div className="field-row" key={i}>
              <input placeholder="如 400x" value={r.magnification} onChange={(e) => update(i, { magnification: e.target.value })} />
              <input placeholder="如 细胞核" value={r.structure} onChange={(e) => update(i, { structure: e.target.value })} />
              <input
                placeholder="后到的不同描述不会覆盖原值，会留档"
                value={r.description}
                onChange={(e) => update(i, { description: e.target.value })}
              />
              <button type="button" className="ghost small" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                删除
              </button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setRows((rs) => [...rs, { magnification: "", structure: "", description: "" }])}>
            + 增加视野
          </button>
        </div>

        <div className="form-footer">
          <label className="confirm-toggle">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            教师已确认（未勾选项作为未完成草稿）
          </label>
          <button className="primary-action" type="submit">{online ? "登记并合并" : "断网登记入队"}</button>
        </div>
      </form>
    </section>
  );
}
