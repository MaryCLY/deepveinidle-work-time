# 批量耗时与并列路线实施计划

> **For agentic workers:** Use independent module workers and a final fresh review. Steps use checkbox syntax; no commits or publication without user instruction.

**Goal:** 在旧版游戏物品与堆叠基线上，统一任务批量耗时，支持收藏制造的多级并列路线与固定选择。

**Architecture:** 保留解析工作期望，独立批量物流模型补充仓库往返和批次周转。纯路线模块生成精确品质依赖，候选与计划共用展开，计划统一分配库存并对合并步骤重新估时。

**Tech Stack:** 原生 ES modules、Node test、现有 esbuild 与 Chrome 合成夹具，不新增依赖。

**Spec:** ../specs/2026-11-17-batch-time-routes-design.md

## Global Constraints

- 用户 2026-11-17 补充：物品列表与堆叠均以仓库旧资源 1.0.1214 为准，测试服 1.0.5543 仅提供流程与耗时参考。
- 用户继续明确：测试服预测时间可作为准确度标称；所有任务统一使用主城仓库 `bankId=1`，不跟随偏好仓库。
- 保留现有未提交资源和授权文档改动；本地开发，不提交、推送或发布。
- 仅收藏制造展开路线；普通制造仅更新耗时；偷窃和升级不加物流耗时；前置不丢弃。
- 显式错误，保留坏存档；路线按实际配方、物品品质与选择标识。

## Review Focus

- 同一个半成品在直购和自制分支竞争库存，必须全计划只抵扣一次。
- 合并制造跨背包边界后按总次数重算，不以单次完整时间线性相乘。
- 旧动态策略没有固定路线信息，保留原条目并提示重新选择，禁止静默换线。
- 缺价、未知库存、不可制造仅影响对应路线，不能清空同目标的直购。
- 升级前置装备与配方品质准确匹配，三级步骤必须按依赖顺序。

## Tasks

### 1. 物流知识库与批量耗时

Files: scripts/extract.mjs, vendor/manifest.json, engine/upstream.js（生成）, engine/batch-time.js, engine/work-player.js, engine/{gathering,crafting,collection}-model.js, capture.js, skill-masteries.js。

- [x] 先写背包边界、堆叠/非堆叠消耗释放、巨大次数、移动修正、未知参数及例外的失败测试。
- [x] 提取纯移动/距离/容量声明，保留来源及确定性摘要；补齐物流角色输入和显式旧格式兼容。
- [x] 实现 estimateBatchTime({job,tier,count,player,actionSeconds,discard})，返回状态、工作/额外/总时间、容量、批数及来源。
- [x] 接入采集，保留被抓等待；从 Chrome 记录训练/独立核对样本和版本限制。
- [x] 运行对应引擎、捕获、来源测试。

### 2. 递归路线

Files: intermediate-routes.js, tests/intermediate-routes.test.mjs。

- [x] 先写三级升级、混合分支、品质/循环拒绝、共享库存、缺价隔离相关测试并确认失败。
- [x] 导出 intermediateSources、intermediateRouteKey、enumerateIntermediateRoutes、validateIntermediateChoices、estimateRouteMaterials。
- [x] choices 为 {itemId,jobId,tier}[]；stock 输入不修改，返回 stockUsed；steps 拓扑合并后调用 estimateStep(job,tier,count) 获取完整时间及 yieldPerAttempt。
- [x] 验证实际配方图无环，可完整枚举而不截断。

### 3. 候选、计划与存档

Files: crafting-estimates.js, workspace.js, engine/collection-plan.js, tests/route-plans.test.mjs 和相关既有测试。

- [x] 先写独立直购/自制时间成本、行情不换线、库存竞争、批量重算与旧策略迁移的失败测试。
- [x] 导出 estimateCollectionRoutes(row,state,prices,players,strategy)，先整数化制造次数再计算完整路线；返回 routeChoices/routeKey/selfCraftedItemIds/mainSeconds/barSteps/costMaterials。
- [x] 保存 routeChoices，旧 optimal/craft 转并列并为已选行保留 legacyStrategy 待用户重选；旧 buy 保持直购。
- [x] discardProducts 持久化布尔值，计算时主任务应用、前置强制 false。
- [x] 采购和计划共用库存预留，合并执行后重新计算批量时间；确保总时间不重复计入前置。

### 4. 界面与文档验收

Files: app.js, 相关 UI 场景, DESIGN.md, docs/{panel,technical,status,test-server}.md。

- [x] 只显示直购/并列；候选标注实际前置名称，key/加入/批量加入/缓存/预填签名保存路线。
- [x] 路线完整计算后进行供应、时间、金币筛选、稳定排序和分页；未知时间明确显示。
- [x] 增加最终产物丢弃设置、旧路线待重选提示与依赖序执行表。
- [x] 更新规范与实际验证记录；全量单元、构建、相关桌面及窄屏浏览器场景；独立代码审查后修复重要问题。

## Baseline and decisions

- 基线 0.5.12，243 项单元测试通过。Volta shim 在沙箱内不能初始化，使用已有 CODEX_MCP_NODE_PATH 直接运行相同 Node 入口。
- 在当前功能分支 codex/intermediate-strategy 原位修改以使用现有未提交资源；不创建额外 worktree，不移动或覆盖用户改动。
- 游戏有限次数结束可能停在工作点；模型按用户约定额外包含最终回仓，因此与游戏预估的收尾口径分别记录。

## Final verification

- `& $env:CODEX_MCP_NODE_PATH --test tests/*.test.mjs`：281/281 通过。
- `& $env:CODEX_MCP_NODE_PATH scripts/build.mjs`：构建通过；版本保持 0.5.12，未发布。
- `CHROME_PATH` 指向已安装 Chrome 后运行 `scripts/test-ui.mjs`：27/27 场景、327 项检查通过，包含 390px。
- `git diff --check` 与 app/workspace 语法检查通过；文档相对链接已核对。
- 独立审查的重要问题均有红→绿回归：丢弃产物不抵扣采购、合并批量时间及费用、执行依赖顺序。
- Chrome 预测公式、堆叠及实配校准见 `docs/test-server.md`；单配方标称不能代表所有次数和角色配置的统一误差上限。
