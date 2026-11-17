# 初始导入验证（本地）

日期：2026-11-17。公开远端 `MaryCLY/deepveinidle-work-time` 已创建；本记录写入时尚未提交或推送代码。

- 本机 Windows／Node.js 20.20.2：`npm ci --ignore-scripts --offline` 通过，`npm test` 19/19 通过。
- 15项包契约和离线打包／安装／实际导入测试通过；4项历史完整性和14,950条物流向量回放通过。
- `npm pack --ignore-scripts --offline` 输出8文件，仅包含LICENSE、README、package.json和5个src文件，未包含历史资料。
- 25份历史原件、原始manifest及来源索引保持原样；逐文件raw与LF摘要均校验。Git过滤前后25/25文件hash一致，历史镜像使用-text保留换行。
- 算法、包边界、资料保留与Git换行修复经过独立审查。

原资料包含672条小时概率、128条有限任务样本、87条Chrome参考、18组路径和4组相位轨迹。它们是历史记录，本轮未重新生成概率数据或连接真实游戏账号；当前物流回放无需相邻Lab/Buddy。

此前Lab暂存阶段另做过4,504组任务期望与7个新跑原始游戏状态机案例对照，最大浮点差约5.7e-14；该结果与本仓库19项本地测试分别记录。Lab网页发布工具的Windows符号链接权限限制不属于此独立库的测试。

Ubuntu的Node.js20／24 CI已配置，尚未在远端执行；未做真实脚本管理器、移动真机、生产或npm registry发布验证。Buddy没有改动。

[来源清单](../tests/fixtures/work-time-baseline/origin.json)记录原文件摘要；[NOTICE](../NOTICE.md)说明自有代码许可与第三方游戏快照的边界，第三方快照的公开再分发许可尚未核验。
