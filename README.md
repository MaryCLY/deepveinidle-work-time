# DeepVeinIdle Work Time

公开仓库：[MaryCLY/deepveinidle-work-time](https://github.com/MaryCLY/deepveinidle-work-time)。包名为 `@dvi-lab/work-time`，当前版本 `0.1.0`。这是无依赖 ESM 工作耗时计算库，使用 Node.js 20+，也可由浏览器工程在构建时打包。

算法迁自 DeepVeinIdle Buddy 的批量时间 v3 与工作期望。运行包不包含游戏资源、角色构造、存档或网页组件；由消费方注入已核验的游戏规则。计算不请求网络，不要求最终用户访问 GitHub，不替换 Lab 网页逐 tick 模拟。

## 作为构建依赖

选择已审查的完整提交 SHA 替换占位值并固定依赖：

```sh
npm install 'github:MaryCLY/deepveinidle-work-time#<FULL_COMMIT_SHA>'
```

提交消费工程的 package.json 和包管理器生成的 lockfile。正常 ESM import 可以由 esbuild 等工具打入最终应用或 userscript；GitHub 仅用于开发或 CI 拉取源码。当前工程不提供运行时下载入口，也不提供独立 min.js，尚未发布 npm registry 包。

也可以从本地生成 tarball，再由消费工程安装生成文件并锁定版本与完整性：

```sh
npm ci --ignore-scripts
npm test
npm pack --ignore-scripts
```

npm 包仅含 `src/`、README、LICENSE 及 npm 自动包含的 package.json；历史夹具、测试、仓库文档与 CI 配置不进入包。package.json 的 `test` 命令供源码仓库使用，包没有安装或构建生命周期脚本。

## 使用

```js
import {createWorkTimeEngine} from '@dvi-lab/work-time';

const engine=createWorkTimeEngine(game,{
 sourceVersion:'1.0.1214',
 sourceSha256:'cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5',
});
const timing=engine.estimateTaskTime({job,tier:0,quantity:100,player,tick:player.lastTick,worldRarity:0});
```

`game` 必须由调用方提供，并对应已核验的 1.0.1214 游戏资源（公开资源 URL 为 `https://deepveinidle.com/assets/index-B2g2JEXj.js`）。元数据是调用方对适配器来源的声明；包核对声明，不能独立证明注入函数来自该资源。包本身不复制、下载或重新授权游戏资源。包代码采用 MIT；测试目录保留的游戏提取声明与注入游戏资源的授权另行处理，公开可访问不表示已获再分发授权。详见 [权利与来源说明](https://github.com/MaryCLY/deepveinidle-work-time/blob/main/NOTICE.md)。

## 适配器契约

初始化会检查来源、下列函数及配置形状。函数必须是同步、确定的已核验游戏规则，签名与旧游戏提取规则一致：

| 成员 | 契约 |
| --- | --- |
| `world` | `sites` 数组、`bankById.get(id)`、`siteById.get(id)`；仓库含 `id,x,y`，工作点另含 `jobIds`。保留寻路函数需要的世界字段。 |
| `siteEntrance(world,x,y,actorId,from?)` | 从当前点选择真实入口，返回 `{x,y}` 或无入口；actorId 为 0。 |
| `walkPath(world,fromX,fromY,toX,toY)` | 返回逐步路径数组或不可达时的 null；数组长度为步数。 |
| `tickMs`、`masteryRankLimit`、`swiftSpeedBonus` | 正 tick 毫秒、非负整数精通上限、非负迅捷药水移速系数。 |
| `tool(encodedId)` | 解码后的工具声明，含 `slot`，用于校验坐骑。 |
| `mountStride(player)`、`inventoryCapacity(player)` | 移动速度和背包格数。 |
| `brewStrength(player,kind)`、`masteryMultiplier(masteries,kind)` | 药水强度与精通倍率。 |
| `recipeInputs(job,tier)`、`recipeOutput(job,tier)`、`item(id)` | 原料 `[{itemId,qty}]`、产物 ID、含 `stackable` 的物品声明。 |
| `workChance(job,player)`、`upgradeTicks(player,upgrade)` | 普通动作每 tick 的 0–1 概率、升级纯工作 tick 数。 |
| `burnChance(job,player)`、`caughtChance(job,player)` | 0–1 烧毁与被抓概率。 |
| `itemSupportsRarity(itemId)`、`level(xp)` | 是否支持品质、技能 XP 对应等级。 |
| `toolLuck(encodedId)`、`equipmentLuck(equipment)` | 工具与装备幸运。 |
| `combine(...multipliers)` | 游戏原有倍率合成规则。 |
| `brewRarityMultiplier(player)`、`hotRarityMultiplier(tick,skill)`、`houseRarityMultiplier(player)` | 品质倍率。 |
| `rarityThresholds` | 含 `uncommon,rare,epic,legendary`，数值为 0–1 且不递增的累计概率阈值。 |

适配器及世界数据创建实例后保持不变。路径缓存属于实例，不会跨实例或世界共享。`job` 为游戏配方声明，包含 `id,skill,levelReq,inputs,output:{itemId,qty}`，可包含 `plain,caught:{stunTicks},upgrade`。`player` 由调用方构造；目标技能 XP 必须为有限非负 number，允许小数。工作规则使用技能 XP、装备、药水、房屋、精通和天赋等原始字段。物流至少需要 `lastTick`、`equipment.mount`、`masteries.move`、`perks.pockets`、`brews` 和 `brewTier`。

## API 与结果

顶层导出 `createWorkTimeEngine`、冻结的 `batchTimeModel`、`gatheringSkills` 和 `toolSlots`。实例提供：

- `estimateBatchTime({job,tier=0,count,player,actionSeconds,discard=false,siteId})`：已知每次期望秒数和次数时，返回 `status,seconds,workSeconds,overheadSeconds,batches,batchCapacity,sourceVersion`，成功时另含路线／移动诊断。`actionSeconds` 可由调用方包含等待时间。
- `workActionSeconds(job,player)`：纯动作秒数；概率为 0 时为 null。升级直接使用其固定 tick。
- `workQualities(player,job,tick,worldRarity)`：普通至传奇的五个品质概率；`plain` 配方为 `[1,0,0,0,0]`。tick 使用捕获的世界 tick，不读取当前时间。
- `estimateWorkExpectation({job,tier=0,quantity,player,tick,worldRarity=0})`：返回 `status,attempts,quantity,burn,caught,quality,actionSeconds,waitSeconds`。目标数量向上取完整产出，次数再按成功与品质概率折算；`actionSeconds` 始终是纯动作时间，`waitSeconds` 是每次尝试的期望被抓等待。
- `estimateTaskTime(options)`：接受期望方法的参数及 `discard,siteId`，先检查技能等级，再用 `actionSeconds + waitSeconds` 组合完整批量耗时；保留两个时间字段，不接收 Buddy state 或收藏目标。

quantity/count 必须为大于零的有限数且不超过安全整数上限；期望采集次数可为小数。tier 为 0–4 整数。调用方处理未初始化、已完成和收藏积分。所有秒数均为期望值；`workSeconds` 在组合方法中包含被抓等待。

状态包括 `ok`、`levelTooLow`、`unreachable` 和 `unknownTime`。物流未知时总时间为 null，保留已知工作时间和原因 `movementConfiguration`／`workLocation`；纯动作时间未知的批量调用返回 `actionTime`。无可用背包容量为 unreachable。无效来源／适配器抛出 `unsupportedSource`／`invalidGameAdapter`；数量、品质、配方、工作配置、概率及溢出错误分别明确抛出 `invalidQuantity`、`invalidTier`、`invalidJob`、`invalidWorkConfiguration`、`invalidResult`、`quantityOverflow`。

## 模型与历史验证资料

模型固定主城仓库 `bankId=1` 空包出发，每批存仓清空，最后回仓；入口按游戏真实选路，逐段移动向上取整，大批次数通过前缀与有限周期算术汇总。仅采集 `discard`、偷窃及升级可省略物流；制造始终保留产物。

未模拟逐次随机掉落、工具免耗材料、未来升级或药水过期，不读取背包杂物、不跟随角色偏好仓库；完整有限任务期望和游戏一小时无限生产预测的线性外推口径不同。此包不做概率模拟，也不将测试标称当作精确秒表实测。

- [设计与维护边界](docs/design.md)
- [历史资料索引](tests/fixtures/work-time-baseline/README.md)与[逐文件来源摘要](tests/fixtures/work-time-baseline/origin.json)
- [Buddy 原始模型档案](tests/fixtures/work-time-baseline/buddy/docs/model-testing/2026-11-17-alpha/README.md)

保留 25 项原始文件，包含 14,950 条物流、672 条小时概率、128 条有限任务数据、18 组代表路径、4 组相位轨迹与 87 条 Chrome 参考。历史资料和摘要原样保留；Git 对历史 `buddy/**` 使用 `-text` 保留原始字节，回归同时核对 raw 与 UTF-8/LF 摘要。其中关于 Lab、Buddy 工作区的旧命令和路径属于收集时语境，当前入口为仓库根目录的 `npm test`。原完整游戏 bundle 未复制，当前回放只读取本仓库保留的生成 upstream 与脱敏配置，不依赖相邻 Lab 或 Buddy 工作区。

当前两个顶层测试文件共 19 项：15 项包契约与离线打包测试、4 项来源／数据／路径／全物流向量回放。CI 定义 Ubuntu 下 Node.js 20 和 24 两组检查；本地结果与实际 CI 运行分别报告。不要递归执行历史目录中的旧 `.test.mjs`、oracle 或归档脚本，不重新生成或覆盖历史数据。
