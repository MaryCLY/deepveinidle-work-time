# 工作耗时历史基线

此目录原样保留 Buddy 的模型 v3 测试记录、数据集、生成输入及相关源码。`buddy/` 镜像原路径；[来源清单](origin.json)逐文件记录收集时的 raw bytes/SHA-256 与 UTF-8 LF 规范化 bytes/SHA-256。收集时已验证每个目标文件与来源字节相同。本仓库对 `buddy/**` 设置 Git `-text` 例外，保留每个历史文件的原始字节及换行，不做检入／检出转换。当前完整性回归同时校验 raw bytes/SHA-256 和 UTF-8/LF 规范化 bytes/SHA-256；规范化摘要用于对照原档案，不替代原字节校验。

## 来源与历史语境

- 来源仓库：`https://github.com/MaryCLY/deepveinidle-buddy`；实际收集时 HEAD：`85ae2eb4e218e5f91a471c908e14010d805b013d`。除下项外，25 个来源文件中的其余文件均从该 HEAD 所在工作树读取，以逐文件摘要标识实际内容。
- `buddy/src/engine/batch-time.js` 从历史提交 `e50b1b53b05e56f297608caddbe340b8d79ab809` 的 Git blob 原样恢复，LF 摘要与原档案输入 `b75785f7c4a5d6fb33440b01120af7275165737824252fca71995f7145c6ac9d` 一致，避免以之后修改的源码解释旧数据。
- [原测试档案](buddy/docs/model-testing/2026-11-17-alpha/README.md)及其 8 个文件均原样保存，未改写原 manifest、sourceBaseCommit、生成时间或历史测试结论。它们属于 `0.6.0-alpha`、游戏资源 `1.0.1214`，不是新 ESM 包的当前验证报告。
- 原 README 中的命令和相对链接均属于 Buddy 上下文，部分仓库内容未镜像，不能直接当作 Lab 开发命令或完整文档导航。历史测试、oracle 和归档脚本只作为证据保存，不在 Lab 执行；特别不要执行旧 `archive-time-model.mjs` 覆盖冻结记录。

## 保留范围与原始资源

保存全部 14,950 条物流、672 条小时概率、128 条有限任务数据，18 组代表路径、4 组相位轨迹，4 个配置／87 条 Chrome 参考，以及相关脱敏参数、实测与调优记录、生成器和原模型源码。Chrome 数值是历史游戏小时标称参考；概率数据是旧原始代码的本地合成样本，均不冒充账号秒表、移动真机或新包浏览器验证。

不复制 8 MB 原始游戏 bundle、账号标识、凭据、聊天、34 MB 全明细或临时日志。原游戏资源在现有 Lab `vendor/game-original.js` 可按同一来源 SHA-256 核对；收集时已核验其 LF 摘要及字节数与旧 manifest 一致。来源 URL、版本、完整 SHA-256 和定位路径保存在 origin.json 的 originalGameBundle 字段，原 manifest 的原资源输入摘要保持不变。

## Lab 当前回放入口

在 Lab 根目录运行 `node --test tests/work-time-baseline.test.mjs`。此[专用回归](../../work-time-baseline.test.mjs)验证来源与冻结数据完整性，再只加载本地镜像的生成 upstream 和脱敏参数，按旧 manifest 三组配置构造移动输入，把全部 14,950 条冻结物流向量交给当前 `@dvi-lab/work-time`。它不运行历史生成器、不重新连接游戏、不依赖相邻 Buddy 工作区，也不重新生成历史概率或 Chrome 观测。

该目录只属于 Lab 源码测试资料；ESM 包的 files 白名单保持 src、README、LICENSE，不把这些历史资料打进 npm 包。
