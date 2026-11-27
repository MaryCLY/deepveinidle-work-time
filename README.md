# DeepVeinIdle Work Time

`@dvi-lab/work-time` 根据角色最终属性、游戏文件和任务目标，估算采集、制造、偷窃和升级的耗时、材料消耗与产量。使用 ESM，构建需要 Node.js 20.9+。

## 安装

从 [GitHub Releases](https://github.com/MaryCLY/deepveinidle-work-time/releases) 安装所需版本的 npm 包。

```sh
npm install 'https://github.com/MaryCLY/deepveinidle-work-time/releases/download/v0.4.0/dvi-lab-work-time-0.4.0.tgz'
```

## 准备游戏文件

在 Node.js 构建脚本中，将可信游戏源码编译为 ESM。下例使用正式服 1.0.1227 的压缩符号。换用其他压缩快照时，按源码核对符号映射。导入生成文件时会执行其中的游戏声明。

```js
import {readFile, writeFile} from 'node:fs/promises';
import {compileGameFile} from '@dvi-lab/work-time/game-file';

const source = await readFile('./vendor/game-original.js', 'utf8');
const {code, diagnostics} = compileGameFile(source, {
  sourceVersion: '1.0.1227',
  symbols: {
    tickMs: 'mo', recipes: 'xe', upgradeRecipes: '$m', items: 'mc', item: 'ie',
    recipeInputs: 'tn', recipeOutput: 'ry', itemSupportsRarity: 'hb',
    rarityThresholds: 'tr', hotRarityMultiplier: 'P8', world: 'X',
    siteEntrance: 'Ts', walkPath: 'NM', withRarity: 'Te', baseItemId: 'io',
    itemTier: 'ee', upgradeMaterials: 'bv', upgradeResult: 'pb',
    levelSpeedCoefficient: 'ZIo', upgradeBaseTicks: 'Seo', bonusMinimumUncommon: 'Ek',
    coinItemId: 'ks', dungeonKeyTier: 'iZ', dungeonKeyChance: 'Nxo',
    dungeonKeyBaseTicks: 'jxo', levelXp: 'os', skillPet: 'vZ', skillPetChance: 'QO',
  },
});
for (const {feature, code, message} of diagnostics) {
  console.warn(`${feature} [${code}] ${message}`);
}
await writeFile('./generated-game.js', code);
```

编译器接受游戏发布 bundle 或已提取的 ESM 源码。见[预处理诊断](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/docs/game-file-check.md)。

## 计算任务

```js
import {createWorkTimeEngine} from '@dvi-lab/work-time';
import {gameFile} from './generated-game.js';

const engine = createWorkTimeEngine(gameFile);
const result = engine.estimateTaskTime({
  character: {
    skills: {
      mining: {level: 20, speedMultiplier: 1.5, luck: 0.1, rareFindBonus: 0.2, keyDropMultiplier: 1},
    },
    movement: {strideSpeed: 1000, capacity: 28},
  },
  environment: {tick: 100, worldRarityBonus: 0},
  task: {jobId: 1, quantity: 100},
});
```

`character` 填最终等级和倍率。加成用小数表示，例如 `0.2` 表示 20%。普通工作统一按最终等级和速度计算单次耗时。计算品质时传入快照 `environment`，计算物流时传入 `movement`。字段单位及各任务所需属性见[输入契约](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/docs/final-character-contract.md)。

## 任务与结果

- `jobId` 填配方数值 ID，升级填 `'upgrade-ID'`。
- `count` 和 `quantity` 二选一。`count` 是正整数尝试次数，`quantity` 是正数目标产量，按单次产量向上取整后反推期望次数。
- `tier` 取 0–4，默认为 0。采集用目标品质，制造和升级用输入品质。多分支升级需提供编码后的 `inputItemId`。
- `siteId` 可指定工作点。采集可设 `discard: true` 丢弃产物。丢弃采集产物、偷窃和升级时跳过物流。
- 保留产物的无材料采矿、钓鱼和伐木按配方副产物、钥匙和技能宠物的占包估算往返时间。提供对应技能的 `keyDropMultiplier`（1 表示没有钥匙掉率加成）、计算掉率所需的品质属性及 `environment`。使用包含这些掉落规则的生成文件。

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

参见[设计](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/docs/design.md)、[验证记录](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/docs/verification.md)和[历史数据来源](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/tests/fixtures/work-time-baseline/README.md)。

### 原生过程回放

在 work-time 仓库安装开发所需依赖后，把原始游戏 JavaScript 快照作为第一个参数传入。脚本离线运行，根据 SHA-256 选择已核对的原生符号，目前支持 1.0.1227。使用 `--help` 查看各脚本的采样参数。

#### 原生采集回放

```sh
node scripts/sample-gathering-work-time.mjs /path/to/game-snapshot.js
node scripts/sample-gathering-work-time.mjs /path/to/game-snapshot.js 48 95,280,447,448,1000,4000 49 .test-artifacts/gathering-drop-native/holdout.json
```

采集回放按固定种子记录装包、周转和回仓，比较新旧估算。默认结果为 `.test-artifacts/gathering-drop-native/trials.json`。

#### 原生制造回放

```sh
node scripts/sample-crafting-work-time.mjs /path/to/game-snapshot.js
```

制造回放按指定次数统计领料、制作和回仓事件，与 `estimateTaskTime` 对照。默认结果为 `.test-artifacts/crafting-native/trials.json`。

#### 原生技能首领投喂回放

```sh
node scripts/sample-boss-feed-work-time.mjs /path/to/game-snapshot.js
```

投喂回放使用合成首领阶段和单种补给，分别核对纯投喂与稳定补料的秒/件。默认结果为 `.test-artifacts/boss-feed-native/trials.json`。

本包代码采用 [MIT](LICENSE)。游戏资源的权利与来源见 [NOTICE](https://github.com/MaryCLY/deepveinidle-work-time/blob/v0.4.0/NOTICE.md)。
