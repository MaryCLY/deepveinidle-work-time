# DeepVeinIdle Work Time

`@dvi-lab/work-time` 根据角色最终属性、游戏文件和任务目标，估算采集、制造、偷窃和升级的耗时、材料消耗与产量。使用 ESM，构建需要 Node.js 20.9+。

## 安装

从 [GitHub Releases](https://github.com/MaryCLY/deepveinidle-work-time/releases) 选择正式版本，将 `<RELEASE_TAG>` 替换为该版本的标签。

```sh
npm install 'github:MaryCLY/deepveinidle-work-time#<RELEASE_TAG>'
```

## 准备游戏文件

在 Node.js 构建脚本中，将调用方提供的可信游戏源码编译为 ESM。导入生成文件时会执行其中的游戏声明。

```js
import {readFile, writeFile} from 'node:fs/promises';
import {compileGameFile} from '@dvi-lab/work-time/game-file';

const source = await readFile('./vendor/game-original.js', 'utf8');
const {code, diagnostics} = compileGameFile(source);
for (const {feature, code, message} of diagnostics) {
  console.warn(`${feature} [${code}] ${message}`);
}
await writeFile('./generated-game.js', code);
```

编译器接受游戏发布 bundle 或已提取的 ESM 源码。见[预处理诊断](docs/game-file-check.md)。

## 计算任务

```js
import {createWorkTimeEngine} from '@dvi-lab/work-time';
import {gameFile} from './generated-game.js';

const engine = createWorkTimeEngine(gameFile);
const result = engine.estimateTaskTime({
  character: {
    skills: {
      mining: {level: 20, speedMultiplier: 1.5, luck: 0.1, rareFindBonus: 0.2},
    },
    movement: {strideSpeed: 1000, capacity: 28},
  },
  environment: {tick: 100, worldRarityBonus: 0},
  task: {jobId: 1, quantity: 100},
});
```

`character` 填最终等级和倍率。加成用小数表示，例如 `0.2` 表示 20%。普通工作统一按最终等级和速度计算单次耗时。计算品质时传入快照 `environment`，计算物流时传入 `movement`。字段单位及各任务所需属性见[输入契约](docs/final-character-contract.md)。

## 任务与结果

- `jobId` 填配方数值 ID，升级填 `'upgrade-ID'`。
- `count` 和 `quantity` 二选一。`count` 是正整数尝试次数，`quantity` 是正数目标产量，按单次产量向上取整后反推期望次数。
- `tier` 取 0–4，默认为 0。采集用目标品质，制造和升级用输入品质。多分支升级需提供编码后的 `inputItemId`。
- `siteId` 可指定工作点。采集可设 `discard: true` 丢弃产物。丢弃采集产物、偷窃和升级时跳过物流。

实例方法均接收 `{character, task, environment}`。

| 方法 | 结果 |
| --- | --- |
| `estimateTaskTime` | 总耗时 `seconds`、工作耗时 `workSeconds`（含风险等待）、物流耗时 `overheadSeconds` 和任务期望。 |
| `estimateWorkExpectation` | 尝试次数、产量、风险、品质、单次动作与等待秒数、材料与产物。 |
| `estimateBatchTime` | 按 `count` 计算动作和物流耗时。 |
| `workActionSeconds` | 单次动作秒数，无法执行时为 `null`。 |
| `workQualities` | 普通至传奇的五项品质概率。 |

`materials` 和 `products` 按编码后的物品 ID 汇总期望数量。`count` 模式下，结果的 `quantity` 是目标品质的期望产量。物流以空包从主城仓库出发，每批存仓，最后回仓。

用 `status` 判断 `ok`、`levelTooLow`、`unreachable` 或 `unknownTime`。缺少物流数据时，总耗时为 `null`，已知工作耗时仍由 `workSeconds` 返回。

## 生活 Boss 投喂

`engine.estimateBossFeedRate({character, task: {bossId, itemId}})` 估算持续投喂一件物品的平均耗时。`itemId` 包含品质编码。使用该投喂技能对应的最终等级、`speedMultiplier` 和 `movement`。`movement.capacity` 是取料时可用于该物品的有效格数。

构建投喂用的游戏文件时，传入当前客户端的符号映射。参照[正式服 1.0.4915 构建示例](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.3.0/docs/game-file-check.md#生活-boss-声明)。

结果含 `feedSecondsPerItem`、`logisticsSecondsPerItem`、`secondsPerItem`、`itemsPerHour`、游戏文件来源和代表路线。纯投喂按完整一件计算，物流按稳定补料循环折算。`secondsPerItemRange` 给出已算出的站位路线的耗时范围。分项缺失时保留可独立计算的结果。公开契约和游戏文件能力见[投喂模型](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.3.0/docs/design.md#生活-boss-投喂)。

## 开发

测试需要 `tar`。

```sh
npm ci --ignore-scripts
npm test
npm pack --ignore-scripts
```

参见[设计](docs/design.md)、[验证记录](docs/verification.md)和[历史数据来源](tests/fixtures/work-time-baseline/README.md)。

本包代码采用 [MIT](LICENSE)。游戏资源的权利与来源见 [NOTICE](NOTICE.md)。
