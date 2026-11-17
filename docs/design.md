# 工作耗时引擎设计

本工程提供 `@dvi-lab/work-time@0.1.0`，以无依赖 ESM 实现 Buddy 批量时间 v3、工作品质与目标数量期望。游戏版本固定为 `1.0.1214`，来源 SHA-256 为 `cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5`。

## 模块与 API

- `src/index.js`：创建实例与完整任务入口，校验原始技能 XP 并组合期望与物流。
- `src/adapter.js`：校验调用方声明的来源和游戏规则适配器，不自行下载或构造游戏资源。
- `src/batch-time.js`：主城仓库起终点、原料占格、批量容量、入口与真实路径、逐段移动取整及有限周期汇总。
- `src/work-expectation.js`：纯动作时间、品质、烧毁／被抓概率、目标数量与独立等待时间。
- `src/domain.js`：采集技能与工具槽位常量。

`createWorkTimeEngine(game,{sourceVersion,sourceSha256})` 返回五个方法：`estimateBatchTime`、`workActionSeconds`、`workQualities`、`estimateWorkExpectation`、`estimateTaskTime`。完整参数、返回值与适配器签名由根 README 统一维护。

运行时仅持有调用方注入的同版本 game adapter，实例分别缓存路线。包不读取存档、行情、页面或角色连接，不构造角色，也不包含第二份运行游戏资源。消费工程固定完整提交或 tarball 完整性，在构建期打包源码。

## 计算约束

保留空包从主城仓库出发、每批存仓、最后回仓；仅采集丢弃、偷窃及升级可跳过物流。缺失物流明确返回 unknownTime，保留已知工作时间。普通动作概率必须为 0–1，0 为不可达；品质必须为 0–4 整数。目标技能 XP 必须为有限非负 number，允许小数；等级只解析一次。

纯 `actionSeconds` 与每次尝试的 `waitSeconds` 分开返回，完整任务使用二者之和。解析期望不模拟未来升级、药水到期、工具免耗材料或逐次随机掉落，不等同于账号有限任务秒表实测。

## 测试与历史资料

`npm test` 显式运行 `tests/work-time-package.test.mjs` 与 `tests/work-time-baseline.test.mjs`：包契约与离线 tarball 消费、来源摘要、冻结数据完整性、代表路径和全部 14,950 个物流向量回放。独立消费测试在临时目录离线安装并实际导入，检查 npm 内容白名单。测试命令使用明确文件名，因为 Node 20 在 Windows 的 npm 默认 shell 下不会展开 `tests/*.test.mjs`；同时避免递归发现历史 fixture 的旧测试。新增顶层测试时同步更新该命令与打包契约断言。

`tests/fixtures/work-time-baseline/buddy/` 是原始证据镜像。25 项文件及原 manifest 不修改、不补写新结论。来源清单同时保存 raw 和 UTF-8/LF 摘要；Git 对历史 `buddy/**` 使用 `-text` 保留原始字节及换行，当前回归同时核对两套 bytes/SHA-256，规范化摘要用于对照原档案。原完整游戏 bundle 未复制；origin.json 中的 Lab 定位路径保留收集时核验语境。旧 runner、oracle、旧测试与归档器只作为历史资料保存，当前测试不运行它们。

npm 包 files 白名单仅为 src、README、LICENSE，package.json 自动包含；仓库测试与历史游戏声明不打入库包。MIT 适用于本包代码，不承诺或扩展原游戏资源的授权。

本地初始导入验证及未验证范围见[验证记录](verification.md)。
