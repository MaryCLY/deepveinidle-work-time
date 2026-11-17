# 按功能校验兼容性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 新游戏版本及SHA变化不阻断可用功能，只有实际调用的不兼容功能报错。
**Architecture:** 构造仅验容器，能力检查移至实际分支；保留所有有效输入计算公式与历史结果结构。
**Tech Stack:** 原生ESM、Node20+、node:test、无新增依赖。
**Spec:** docs/design.md#功能兼容性

## Global Constraints

- Buddy/Lab不修改；原25项历史资料和origin不改。
- 版本和SHA仅作历史来源，不做运行准入。
- 无关能力缺失不影响正常调用；所需能力缺失明确报具体功能/能力。
- 不吞掉适配器异常，不把未知物流当零。
- 不在本轮重构角色参数API或计算公式。

## Review Focus

- plain、升级、零概率、等级不足及纯工作分支不能验证无用能力。
- 缺少地图或品质能力不能阻断其他方法，同一实例失败后其他方法仍可用。
- 保留方法this语义与原未知时间、非法概率、XP及数量校验。
- 保留历史sourceVersion字段含义，避免宣称新版本语义已自动验证。
- 离线打包和14,950向量回放继续通过。

### Task 1: 能力检查与回归

**Files:** src/{adapter,index,batch-time,work-expectation}.js, tests/work-time-package.test.mjs
- [x] 先替换旧版本拒绝断言，并为新版本、最小adapter、功能隔离和缺能力写回归，确认RED。
- [x] 移除来源准入、在实际使用位置检查能力，保留公式和返回状态，确认GREEN。
- [x] 跑npm test及离线打包，验证14,950条物流及25份原件。

### Task 2: 文档与审查

**Files:** README.md, docs/design.md, docs/verification.md
- [x] 更新构造示例、按功能能力表、诊断与兼容性边界。
- [x] 独立审查本次diff并修复实际问题。
- [x] 记录本轮实际验证及未执行项，检查git diff --check；提交／推送遵循当前授权范围。
