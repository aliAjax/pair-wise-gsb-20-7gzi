# hxwl-06 显微镜玻片观察（离线优先）

断网时教师登记样本、染色批次与多个观察视野，网络恢复后与室内记录合并的记录库。
React + Vite + TypeScript，规则核心是纯函数 + 版本快照，状态持久化在 localStorage。

## 本地运行

```bash
npm install
npm run dev        # 开发：http://localhost:5106
npm test           # 领域规则测试（61 条断言，esbuild 编译后 Node 运行）
npm run typecheck  # tsc 严格类型检查
npm run build      # 生产构建
```

## 业务规则实现

| 需求 | 实现位置 | 行为 |
| --- | --- | --- |
| 断网登记样本/批次/多视野，恢复后与室内记录合并 | `domain/store.ts` 离线队列、`domain/merge.ts` `mergePack` | 断网操作整包入本地队列；恢复后按登记顺序依次合入 |
| 同一玻片同一批次的重复视野并进一条记录 | `merge.ts` 自然键 `玻片::批次` + 视野键 `倍数@结构` | 记录确定性 ID，两端独立生成也收敛到一条；重复视野的来源累加 |
| 后到内容不能覆盖 | `applyField` | 字段首次写入为准；不同的后到描述进入 `alternates` 留档，原值不动 |
| 染色批次失效 | `lifecycle.ts` `invalidateBatch` | 已确认/已复核 → `reconfirm` 待重新确认；未完成草稿 → `paused` 停住；数据不删 |
| 批次恢复 | `restoreBatch` / `reconfirm` / `resumePaused` | 换有效批次后教师复认；停住草稿解除停住 |
| 两人同时复核只过一份 | `submitReview`（乐观锁版本 + 同轮次判定） | 第一份 accepted，后到者整份保留为 draft，依据、时间、所基于版本完整留痕 |
| 合并异常可恢复、旧数据保留 | `mergePack` 隔离 + `recoverAnomaly` | 高版本包整包隔离；单条 op 异常只隔离该条；原始包始终保留，支持强制恢复（冲突以室内侧为准） |
| 旧版本兼容 | `migrate` | 旧库补齐字段、打 `compat` 标记，旧值完整保留，之后走统一合并管道 |
| 看板/详情/导出同一版本 | `versions.ts` 快照 + 当前版本指针 | 每次变更追加不可变快照；三处都只读 `currentVersionId` 指向的快照 |
| 回滚不丢数据 | `rollback` | 回滚 = 追加"回滚版本"并移指针，旧版本仍在版本线上可再回去 |

合并是幂等的：每个操作有客户端 `opId`，重传或异常恢复时已应用操作自动跳过。

## 界面演示路径

1. **看板**：种子数据已有玻片 BP-12 / 批次 I-07 的 400x 室内记录。
2. 顶部切到「断网」，点「模拟2号台登记」「模拟5号台登记」入队；切回「在线」后点「合并队列」：
   同玻片同批次归并成一条，2 号台重复的 400x 不同描述显示为"后到内容留档未覆盖"。
3. 「染色批次」→ 标记 I-07 失效：已确认记录变「待重新确认」；恢复批次有效后可复认。
4. 详情弹窗或顶部「双师同时复核」：王老师通过，李老师同版本提交被保留为草稿（依据不丢）。
5. 「模拟高版本包 / 模拟冲突包」→「合并异常」页查看隔离的原始包，尝试恢复/强制恢复/归档。
6. 「版本与导出」沿版本线回滚，导出 JSON 与看板详情严格同版。

## 目录

```
src/domain/   types / merge / lifecycle / versions / seed / store（纯领域逻辑，可独立测试）
src/components/  Board RegisterForm BatchPanel AnomalyPanel VersionPanel RecordModal
tests/domain.test.ts  六个需求场景的断言
```
