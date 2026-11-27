# 游戏文件预处理诊断

游戏文件预处理沿用同步入口 `compileGameFile(source, options)`。在提取声明闭包的过程中逐项检查并返回 `{code, features, diagnostics, source}`；不新增独立检查API、CLI或第二个预处理入口。

- 检查必要声明、可提取依赖及被省略的外部初始化；每个能力独立收集诊断，单项失败不污染其他能力。
- `reduce`／`reduceRight` 分别跟踪累加器、元素和源数组；只有回调始终返回未重绑的原累加器时，才将独立初值视为与源数组分离，其他回调保守保留源别名，通过外部累加器、元素或第四个回调参数修改已选声明时仍报告遗漏初始化。
- 未发生属性改写的对象字面量方法按其函数体分析，普通方法绑定接收者 `this`，嵌套箭头沿用词法 `this`；已改写或未知的方法保留保守写入检查。空 Map／WeakMap 的命中即返回、计算后 set 并返回同一值可作为冷缓存提取；Map 在正整数容量上限处先 clear 的同类路径也适用，外部预填仍报告遗漏初始化。
- 调用方构建脚本逐条打印 `diagnostics`，兼容性诊断不主动阻断生成产物。版本与SHA仅作追溯。
- 源码语法、输入参数等错误导致无法预处理时明确抛错，不返回伪造产物。
- 预处理不执行游戏代码，不导入生成模块，不使用合成角色逐配方试跑。实际计算仍按使用分支检查必要能力并明确报错。
- 这些检查不证明未来规则的精度或语义兼容性，也不作版本一致性检查。

验证复用预处理器的声明、依赖、初始化和局部失败测试，并在隔离安装的包中实际验证诊断与可用能力。原始测试记录和冻结数据保持只读。

## 采集掉落声明

保留产物的无材料采矿、钓鱼和伐木需要采集掉落规则。已提取源码可直接使用语义化导出，压缩快照通过 `symbols` 提供对应符号。正式服 1.0.1227 的完整映射见[原生回放共用模块](../scripts/native-replay.mjs)。

## 生活 Boss 声明

投喂能力有语义化导出或 `symbols` 显式映射时才尝试提取。以下示例对应正式服 1.0.4915 的 `index-szBaIgSm.js`，SHA-256 为 `7fdb0dbe3a5aa0bda15768e45c55a5f064508b5259e1b6f44c0cb5e271b3272c`。将 `source` 替换为调用方加载的可信源码。部署改变符号后以新源码核对映射。 [正式服客户端](https://deepveinidle.com/assets/index-szBaIgSm.js)

```js
const {code, diagnostics} = compileGameFile(source, {
  sourceVersion: '1.0.4915',
  sourceUrl: 'https://deepveinidle.com/assets/index-szBaIgSm.js',
  symbols: {
    tickMs: 'ue', recipes: 'Ve', upgradeRecipes: 'Un', items: 'li', item: 'Xe',
    recipeInputs: 'ba', recipeOutput: 'du', itemSupportsRarity: 'Nd',
    rarityThresholds: 'Vh', levelSpeedCoefficient: '_le', upgradeBaseTicks: '$B',
    hotRarityMultiplier: 'mA', world: 'P', siteEntrance: 'xs', walkPath: 'ik',
    bonusMinimumUncommon: 'Cb', withRarity: '$o', baseItemId: 're', itemTier: 'eo',
    upgradeMaterials: 'Xp', upgradeResult: '_d',
    bosses: 'ke', bossUnlockLevel: 'Br', bossFeedRecipe: 'Up', bossFeedParts: 'hz',
    bossUsesFarmingSpeed: 'Xue', bossHeartLayout: 'ct', bossKrakenLayout: 'Ra',
    bossColonyLayout: 'rr', bossBlightLayout: 'Xa', bossSiegeLayout: 'sn',
  },
});
```
