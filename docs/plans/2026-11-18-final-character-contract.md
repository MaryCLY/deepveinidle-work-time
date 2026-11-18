# 最终角色契约实施计划

> Use superpowers:subagent-driven-development for independent tasks and review. No commit/push until current authorization scope is checked.

**Goal:** 角色最终属性+游戏文件+任务输入，模块完成派生计算。
**Spec:** docs/final-character-contract.md
**Architecture:** Node AST构建提取，浏览器纯ESM估算；复用物流，原资料只读。
**Tech Stack:** Node20+、Acorn8.15.0/eslint-scope8.4.0（复用现有工具版本）、原生ESM、node:test。

## 约束
- 不修改Buddy/Lab、原25资料及origin；不下载游戏或读取账号数据。
- 不按版本/hash阻断，不执行完整客户端，不宣称编译器是沙箱。
- 所有最终角色值显式单位，任务派生量由库计算；升级速度独立。
- npm维护manifest/lock，0.2.0不打tag、不发布registry。
- 新旧路径分别验，不能只跑旧测试宣称新接口完成。

## Task 1: 游戏文件提取
- [x] 先写compileGameFile回归并看RED。
- [x] AST闭包/语义导出/符号映射/每功能diagnostics，不执行输入。
- [x] 真实保留文件及本地原bundle提取对照、版本变动/缺能力验证。

## Task 2: 最终属性计算入口
- [x] 写新character+task期望向量RED。
- [x] 实现等级、速度、风险、品质、升级、材料与产物；最终movement直接使用。
- [x] 保留内部rule回归，主导出切换新契约并验证14950向量。

## Task 3: 集成、文档和验证
- [x] 更新package exports/scripts/version/lock、离线消费测试及README/AGENTS。
- [x] 全量测试、打包、隔离消费、文档/源码检查、分任务独立审查。
- [x] 最终整支审查和门禁收口。
- [x] 记录本轮实际结果与未覆盖内容，完成授权范围内交付。
