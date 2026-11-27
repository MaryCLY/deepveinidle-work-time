# 最终角色属性与游戏文件契约

## 目标和边界

用户已确认：输入为角色最终属性、游戏文件和任务目标；派生的任务概率、品质、次数、产物、物流由模块计算。调用方不传装备/精通/药水原始配置，不编写workChance等任务回调。游戏版本/SHA仅追溯，按实际功能校验，不做全版本白名单。原25文件和origin只读。

## 游戏文件

Node构建入口 `@dvi-lab/work-time/game-file` 导出 `compileGameFile(source,{symbols?,sourceVersion?,sourceUrl?}={})`。接受可信游戏发布JS全文或已提取ESM文本，AST/作用域提取必要声明闭包，返回 `{code,features,diagnostics,source}`；code为可由构建工具写入并import的ESM，导出 `gameFile` 和default。提取过程中检查声明、依赖和外部初始化，单项问题返回diagnostics供构建脚本打印，不阻断其他能力的产物；语法与输入错误明确抛错。编译只生成代码，不执行输入，不加载完整客户端；生成模块包含可信游戏声明，不是任意JS沙箱。禁止解析入口默认发网络请求。调用方只做文件加载/构建集成，提取由本包完成。

已提取文件优先按语义export解析，完整bundle使用受支持符号映射及可识别语义锚点；可选symbols用于新压缩映射。每项闭包单独记录失败，只有使用缺失能力才报错。不会声称自动理解任何未来压缩方式或机制变化。

gameFile必要能力按功能提供：tickMs、recipes、upgradeRecipes、items/item、recipeInputs/recipeOutput/itemSupportsRarity、rarityThresholds、levelSpeedCoefficient、upgradeBaseTicks、hotRarityMultiplier、world/siteEntrance/walkPath、bonusMinimumUncommon（仅配方bonus需要）、withRarity/baseItemId/itemTier、upgradeMaterials/upgradeResult（物品编码与升级规则）。基线映射来自已核对1214声明，版本及hash不作为条件。提取不包含角色属性汇总函数、登录、网络或页面组件。

计算保留产物的无材料采矿、钓鱼和伐木的物流时另用 `coinItemId`、`dungeonKeyTier(levelReq)` 和 `skillPet(skill)`。有钥匙时用 `levelXp(level)`、`dungeonKeyBaseTicks(job, xp)` 和 `dungeonKeyChance(find, baseTicks, rarityMultiplier)`。有技能宠物时用 `skillPetChance(skill)`。

## 角色最终属性

`character.skills[skill]`：
- `level`：最终技能等级，正整数。
- `speedMultiplier`：当前普通工作或投喂动作的最终速度倍率。1 表示无属性加速，0 表示无法执行。相对任务等级修正由引擎计算。
- `upgradeSpeedMultiplier`：升级使用的最终速度倍率，仅升级需要；旧规则升级不含副手，不能冒用普通速度。
- `luck`：最终幸运的小数加成，0.2表示20%，包含工具及装备幸运。
- `rareFindBonus`：寻宝/稀有发现等个人最终加成的小数和，0.2表示20%；不包含luck、任务/环境热度和世界增益。
- `keyDropMultiplier`：采集钥匙掉率的最终倍率，有限且至少为 1。计算采集掉落占包时提供，1 表示没有钥匙发现加成。
- `failureMultiplier`：角色对烧毁/被抓概率的最终乘数，仅有相应风险时需要；1表示不减免。不读取天赋等级重算。

`character.movement={strideSpeed,capacity}` 提供最终移动值和背包格数，用于保留产物的物流和首领补料。移动值 1000 表示每 Tick 一格，与游戏 `stride` 同单位。投喂时 `capacity` 为补料时可供目标物品使用的格数。

`environment={tick,worldRarityBonus}`：品质涉及游戏热度/世界增益时显式提供；worldRarityBonus为小数。未使用功能不要求相关属性；必要字段缺失明确错误，不填默认0/1掩盖未知。

## 任务与公共API

主入口 `createWorkTimeEngine(gameFile)`，返回 `estimateTaskTime({character,task,environment})`，task为 `{jobId,tier=0,count?,quantity?,discard=false,siteId?,inputItemId?}`。count（次数）和quantity（目标品质产量）恰好一个；普通jobId为配方ID，升级为upgrade-ID。单输入升级可从tier推导inputItemId；多输入升级须显式给物品，显式tier冲突时报错。制造tier表示原料品质，实际输出按游戏规则。模块查配方，不让调用方传任务概率、单次时间或materials。低层时间/期望/品质/预计产物方法亦使用最终character并复用同一规则。

`estimateTaskTime` 和 `estimateBatchTime` 计算保留产物的无材料采矿、钓鱼和伐木时均计入掉落占包。主产物、配方副产物品质和钥匙掉率按需使用最终品质属性及 `environment`。有烧毁或被抓规则的配方需要 `failureMultiplier`。此时 `batchCapacity`、`batches`、`totalWalkTicks` 和 `walkStarts` 可为小数。

所有普通工作统一使用最终等级和速度计算。普通单次概率 = min(1, (1+max(0,level-levelReq)*游戏levelSpeedCoefficient)*speedMultiplier/baseTicks)。升级用游戏upgradeBaseTicks、任务等级修正和upgradeSpeedMultiplier，保留取整/至少1tick规则。烧毁/被抓由配方风险随等级衰减，再乘failureMultiplier。品质使用游戏阈值乘(1+luck)*(1+rareFindBonus+worldRarityBonus+hotMultiplier-1)，plain主产物固定普通。所有公式以已核对游戏原声明为依据，不拟合常数。

结果保留status/seconds/workSeconds/overheadSeconds/attempts/quantity/burn/caught/quality/actionSeconds/waitSeconds等；添加materials及products（主产物各品质、烧毁副产物、配方显式bonus），次数模式返回期望产量；目标模式按指定品质反推期望次数。先消耗材料、判烧毁再判被抓；烧毁副产物每事件一个，wait乘未烧毁概率。bonus按成功工作事件及游戏品质规则计算。材料、产量和物流使用当前角色快照。物流沿用原 v3 路径和相位，并在内部直接读最终 movement。

## 迁移与验证

0.2.0主API采用新契约；0.1适配器计算模块只作为内部实现/回归参考，不作为新主入口，不另增加对外兼容层。旧规则行为测试显式对照内部rule engine，离线消费测试改验新公共契约，补新公共接口独立期望向量及全部14950物流回放，不能拿旧路径通过冒充新接口已验。

测试覆盖：最终属性无需原始装备；等级/速度/幸运/寻宝/风险/升级分离；文件提取不执行客户端、支持语义导出/缺失能力/版本差异；count与quantity、材料产物和bonus；纯工作/物流隔离；离线包消费/构建入口；原25资料raw/LF不变。游戏文件在Node构建期解析，浏览器运行入口不依赖Node内建模块。
