# DeepVeinIdle Work Time

公开仓库：[MaryCLY/deepveinidle-work-time](https://github.com/MaryCLY/deepveinidle-work-time)。包名 `@dvi-lab/work-time`，当前版本 `0.2.0`，Node.js 20.9+，ESM。

输入为**角色最终属性、游戏文件、任务目标**。模块查配方，计算动作时间、风险、品质、目标次数、材料／产物和物流。调用方负责获取角色快照和加载可信游戏文件，不必传装备／精通／药水配置或编写任务概率回调。Buddy、Lab 的接入另行进行。

## 构建依赖

选择已审查的完整提交 SHA 并固定，提交消费工程的 manifest 和包管理器生成的 lockfile：

```sh
npm install 'github:MaryCLY/deepveinidle-work-time#<FULL_COMMIT_SHA>'
```

这是构建时依赖：由消费工程打入应用或 userscript，最终用户无需访问 GitHub。也可用 `npm pack --ignore-scripts` 生成 tarball 安装。当前没有独立 min.js，未发布 npm registry 包。包没有安装／构建生命周期脚本。

## 准备游戏文件

Node 构建脚本使用独立入口：

```js
import {readFile, writeFile} from 'node:fs/promises';
import {compileGameFile} from '@dvi-lab/work-time/game-file';

const source = await readFile('./vendor/game-original.js', 'utf8');
const compiled = compileGameFile(source, {
 sourceVersion: '来源版本，仅作记录',
});
for (const {feature, code, message} of compiled.diagnostics) {
 console.warn('[WARN] ' + feature + ' [' + code + '] ' + message);
}
await writeFile('./generated-game.js', compiled.code);
```

接受可信发布 bundle 或已提取的 ESM 文本。编译器使用 Acorn / eslint-scope 提取声明闭包，返回 `{code,features,diagnostics,source}`；生成模块导出 `gameFile` 和 default，附带来源 SHA-256。编译时不执行输入、不加载客户端、不请求网络。**生成模块导入时会执行选中的游戏声明；仅适用于可信源码，不是任意 JavaScript 的安全沙箱。**

优先识别语义命名导出；完整压缩 bundle 使用已核对的基线符号映射与速度系数语义锚点。新压缩命名可通过 `symbols:{能力名:'源符号'}` 覆盖。预处理边提取边检查必要声明、依赖和外部初始化，单项失败进入 diagnostics，构建脚本如上逐条打印警告；其他可提取能力仍生成产物。语法或输入参数错误无法预处理时明确抛错。不按版本／SHA 拒绝文件；只有实际调用缺失能力时才报错。能力存在不保证未来机制仍符合当前模型，机制变化需要新增验证。不会自动理解任意未来 bundle。

解析器依赖只由 Node 构建入口加载；浏览器运行入口不导入解析器或 Node 内建模块。游戏文件由消费工程自行取得，本包不下载游戏资源。检查随本次预处理完成，不另设检查命令，不自动导入或试跑生成的代码；[诊断边界](docs/game-file-check.md)。

## 计算任务

```js
import {createWorkTimeEngine} from '@dvi-lab/work-time';
import {gameFile} from './generated-game.js';

const engine = createWorkTimeEngine(gameFile);
const result = engine.estimateTaskTime({
 character: {
  skills: {
   mining: {level:20, speedMultiplier:1.5, luck:0.1, rareFindBonus:0.2},
  },
  movement: {strideSpeed:1000, capacity:28},
 },
 environment: {tick:100, worldRarityBonus:0},
 task: {jobId:1, tier:0, quantity:100, discard:false},
});
```

这是显式快照；必需字段缺失时不会补零／一。未使用的字段不要求提供。

| 输入字段 | 单位与含义 |
| --- | --- |
| `character.skills[skill].level` | 最终技能等级，正整数，不传 XP。 |
| `speedMultiplier` | 普通工作最终速度倍率；1 为无属性加速，0 为无法工作；不含相对任务等级加速。 |
| `upgradeSpeedMultiplier` | 升级独立最终速度倍率。基线游戏升级不含副手，不能复用含副手的普通速度。 |
| `luck` | 工具及装备最终幸运的小数加成，0.2 表示 20%。 |
| `rareFindBonus` | 个人寻宝等加成的小数和，不含幸运、世界和热度。 |
| `failureMultiplier` | 最终风险减免乘数，1 表示不减免；仅有烧毁／被抓风险时使用。 |
| `movement.strideSpeed` | 最终移动值，1000 表示每 tick 一格。 |
| `movement.capacity` | 最终背包格数，非负整数。仅需物流时使用 movement。 |
| `environment.tick` | 捕获的非负整数世界 tick，不读取当前时间。 |
| `environment.worldRarityBonus` | 世界品质加成的小数值；需要品质时，零也显式传入。 |

普通概率使用最终速度和游戏等级系数，升级使用游戏基础 tick 并保留取整、至少一个 tick。品质使用游戏累计阈值与 `(1+luck)*(1+rareFindBonus+worldRarityBonus+hotMultiplier-1)`。

## 任务与结果

`task={jobId,tier=0,count?,quantity?,discard=false,siteId?,inputItemId?}`：

- 普通 jobId 为配方数值 ID；升级为 `'upgrade-ID'`。
- count 与 quantity 恰好传一个。count 是正整数尝试次数；quantity 是正有限目标数量，向上取整至配方单次产量，再反推期望尝试次数。
- tier 是 0–4 整数。采集表示目标品质；制造表示原料品质，实际产物依游戏 `recipeOutput` 规则；升级表示输入品质。
- 升级有多个输入分支时必须给 encoded `inputItemId`；只有一个分支可按 tier 推导。显式输入可推导品质，和显式 tier 冲突时报错。物品编码与升级规则来自游戏文件。
- discard 只对采集有效；偷窃与升级省略物流，制造保留产物。siteId 可指定工作点。

实例方法均接收 `{character,task,environment}`：

| 方法 | 结果 |
| --- | --- |
| `estimateTaskTime` | 完整期望与物流；含 status、seconds、workSeconds、overheadSeconds、attempts、quantity、burn、caught、quality、actionSeconds、waitSeconds、materials、products，以及批量／路线诊断。 |
| `estimateWorkExpectation` | 尝试次数、目标产量、风险、品质、纯动作及等待秒数、材料／产物；不计算物流。 |
| `estimateBatchTime` | 仅 count 模式；由属性计算纯动作与物流，不计算风险等待、品质及产物，用于独立时间分析。完整任务用上面的主入口。 |
| `workActionSeconds` | 纯单次动作秒数；零速／等级不足为 null。 |
| `workQualities` | 普通至传奇的五项概率；制造／升级按任务输入品质，实际产物编码依游戏规则。 |

`materials` 与 `products` 为 `{encodedItemId:expectedQuantity}` 映射，合并同 ID。包含原料、主产物各品质、烧毁副产物及配方显式 bonus，不外推宠物／坐骑奖励。count 模式的 quantity 表示目标品质的期望产量。

每次尝试先消耗材料，再判烧毁，再判被抓；烧毁副产物每次事件一个，bonus 在成功事件后按配方概率计算。burn/caught 为条件风险概率，waitSeconds 已考虑烧毁会先终止该次尝试。actionSeconds 与 waitSeconds 独立；主入口的 workSeconds 包含等待。

状态包括 `ok`、`levelTooLow`、`unreachable` 和 `unknownTime`。缺失／无效物流配置时 seconds 为 null，保留已知 workSeconds 和 reason；无容量不可达。缺失或不兼容的游戏能力抛出 `invalidGameAdapter` 错误，附 `feature`／`capability`。其他错误包括 `invalidGameFile`、`invalidWorkConfiguration`、`invalidJob`、`invalidTier`、`invalidQuantity`、`invalidResult`、`quantityOverflow`；原游戏函数异常不会静默吞掉。

顶层另导出冻结的 `batchTimeModel`、`gatheringSkills`、`toolSlots`。gameFile 及世界数据创建实例后保持不变，路径缓存属于实例。`sourceVersion` 结果字段为模型历史验证基线，不表示注入资源已通过该版本验证。

## 模型、兼容性和测试

物流沿用 v3：空包从主城仓库 bankId=1 出发，每批存仓，最后回仓；真实入口与路径逐段取整，有限周期算术处理大数量。容量不随随机品质／bonus 波动，不模拟未来等级、药水过期、工具免耗材料或背包杂物；结果是期望值，不等同账号秒表实测。

`0.2.0` 主 API 是最终属性契约，对 0.1 的原始 player／规则回调 API 有破坏性变化。旧实现只作内部回归参考，不提供公开兼容入口。

```sh
npm ci --ignore-scripts
npm test
npm pack --ignore-scripts
```

开发验证需系统 tar（当前Windows／Ubuntu已提供），用于原样封装已安装解析依赖，避免npm目录打包错误运行其prepare。npm test 显式运行当前四个顶层文件，避免 Windows glob 差异及递归运行历史归档测试。包含新接口期望向量、提取与实际导入、新接口及内部旧路径分别回放 14,950 条物流、原25文件 raw/LF 摘要、隔离 tarball 离线消费。离线测试将 lockfile 对应已安装解析依赖制成本地tarball预置，隔离安装并调用包的两个公开入口；不依赖相邻仓库。CI 配置 Node 20/24，实际执行结果见验证记录。

保留原25文件及数据：14,950条物流、672条小时概率、128条有限任务、18组路径、4组相位轨迹、87条 Chrome 参考。历史文件及 origin 原样只读，不重生成；新结果与历史结论分开。[来源索引](tests/fixtures/work-time-baseline/README.md)、[设计](docs/design.md)、[详细契约](docs/final-character-contract.md)、[验证记录](docs/verification.md)。

运行包白名单只有 src、README、LICENSE 和 package.json，不包含历史游戏快照、测试和数据集。包代码 MIT 不扩展游戏资源授权，公开资源不代表已获再分发许可，见[权利说明](https://github.com/MaryCLY/deepveinidle-work-time/blob/main/NOTICE.md)。
