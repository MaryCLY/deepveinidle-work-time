# 工作耗时引擎设计

本工程提供 `@dvi-lab/work-time@0.1.0`，以无依赖 ESM 实现 Buddy 批量时间 v3、工作品质与目标数量期望。历史验证基线为游戏 `1.0.1214`，来源 SHA-256 为 `cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5`；版本和摘要仅记录来源，不作为运行准入条件。

## 模块与 API

- `src/index.js`：创建实例与完整任务入口，校验原始技能 XP 并组合期望与物流。
- `src/adapter.js`：在具体功能实际使用时检查所需能力并给出诊断，不校验游戏资源版本或摘要，不自行下载或构造游戏资源。
- `src/batch-time.js`：主城仓库起终点、原料占格、批量容量、入口与真实路径、逐段移动取整及有限周期汇总。
- `src/work-expectation.js`：纯动作时间、品质、烧毁／被抓概率、目标数量与独立等待时间。
- `src/domain.js`：采集技能与工具槽位常量。

`createWorkTimeEngine(game={})` 返回五个方法：`estimateBatchTime`、`workActionSeconds`、`workQualities`、`estimateWorkExpectation`、`estimateTaskTime`。完整参数、返回值与适配器签名由根 README 统一维护。

运行时仅持有调用方注入的 game adapter，实例分别缓存路线。包不读取存档、行情、页面或角色连接，不构造角色，也不包含第二份运行游戏资源。消费工程固定完整提交或 tarball 完整性，在构建期打包源码。

## 功能兼容性

构造时仅检查适配器容器形状，不要求全套能力。既有调用额外传入的来源对象不参与校验或运算；缺省、新版本或不同摘要均不阻止可用功能。`batchTimeModel.sourceVersion` 及结果的 `sourceVersion` 保留为模型历史验证基线，不代表注入资源已被验证为该版本。

检查跟随实际执行分支：普通动作、升级、品质、等级、移动、路径和容量分别检查所使用的函数／数据。纯批量工作时间与plain品质不需要游戏能力；升级跳过普通工作、烧毁与品质规则；普通制造不需要采集品质函数；显式地点仅使用索引目标，默认地点才扫描站点列表；无候选即返回未知地点，不访问无用的银行或入口。未使用的地点索引、寻路及药水能力不提前阻断。检查后仍通过适配器方法调用，保留this语义。

本次必需能力缺失或形状不符时，在调用处抛出以`invalidGameAdapter`开头的错误，附具体功能与能力名。角色配置、数量、概率及溢出继续明确校验；现有unknownTime和不可达状态保留，适配器自身异常不吞掉。普通动作概率为0时，期望入口直接返回unreachable，保留quantity；actionSeconds、attempts及未计算的burn/caught/quality/waitSeconds为null，避免为诊断访问无关能力；升级的确定性字段保持原值。

能力检查可以发现接口缺失和非法值，不能自动证明新游戏版本的规则语义符合v3模型。仓库起终点、相位和概率等假设的机制变化仍需要新样例验证；新结果另存，原25项历史资料及摘要只读。

## 计算约束

保留空包从主城仓库出发、每批存仓、最后回仓；仅采集丢弃、偷窃及升级可跳过物流。缺失物流明确返回 unknownTime，保留已知工作时间。普通动作概率必须为 0–1，0 为不可达；品质必须为 0–4 整数。目标技能 XP 必须为有限非负 number，允许小数；等级只解析一次。

纯 `actionSeconds` 与每次尝试的 `waitSeconds` 分开返回，完整任务使用二者之和。解析期望不模拟未来升级、药水到期、工具免耗材料或逐次随机掉落，不等同于账号有限任务秒表实测。

## 测试与历史资料

`npm test` 显式运行 `tests/work-time-package.test.mjs` 与 `tests/work-time-baseline.test.mjs`：包契约与离线 tarball 消费、来源摘要、冻结数据完整性、代表路径和全部 14,950 个物流向量回放。独立消费测试在临时目录离线安装并实际导入，检查 npm 内容白名单。测试命令使用明确文件名，因为 Node 20 在 Windows 的 npm 默认 shell 下不会展开 `tests/*.test.mjs`；同时避免递归发现历史 fixture 的旧测试。新增顶层测试时同步更新该命令与打包契约断言。

`tests/fixtures/work-time-baseline/buddy/` 是原始证据镜像。25 项文件及原 manifest 不修改、不补写新结论。来源清单同时保存 raw 和 UTF-8/LF 摘要；Git 对历史 `buddy/**` 使用 `-text` 保留原始字节及换行，当前回归同时核对两套 bytes/SHA-256，规范化摘要用于对照原档案。原完整游戏 bundle 未复制；origin.json 中的 Lab 定位路径保留收集时核验语境。旧 runner、oracle、旧测试与归档器只作为历史资料保存，当前测试不运行它们。

npm 包 files 白名单仅为 src、README、LICENSE，package.json 自动包含；仓库测试与历史游戏声明不打入库包。MIT 适用于本包代码，不承诺或扩展原游戏资源的授权。

本地初始导入验证及未验证范围见[验证记录](verification.md)。
