const sourceVersion='1.0.1214';
const sourceSha256='cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5';
const requiredFunctions=[
 'siteEntrance','walkPath','tool','mountStride','brewStrength','masteryMultiplier','inventoryCapacity',
 'recipeInputs','recipeOutput','item','workChance','upgradeTicks','burnChance','caughtChance',
 'itemSupportsRarity','level','toolLuck','equipmentLuck','combine','brewRarityMultiplier',
 'hotRarityMultiplier','houseRarityMultiplier',
];
const thresholds=['uncommon','rare','epic','legendary'];

export function validateAdapter(game,source){
 if(source?.sourceVersion!==sourceVersion||source?.sourceSha256!==sourceSha256)throw Error('unsupportedSource');
 const finiteNonnegative=value=>Number.isFinite(value)&&value>=0;
 if(!game||requiredFunctions.some(name=>typeof game[name]!=='function')
  ||!Number.isFinite(game.tickMs)||game.tickMs<=0
  ||!Number.isSafeInteger(game.masteryRankLimit)||game.masteryRankLimit<0
  ||!finiteNonnegative(game.swiftSpeedBonus)
  ||!Array.isArray(game.world?.sites)||typeof game.world?.bankById?.get!=='function'||typeof game.world?.siteById?.get!=='function'
  ||thresholds.some((name,index)=>!finiteNonnegative(game.rarityThresholds?.[name])||game.rarityThresholds[name]>1
   ||index>0&&game.rarityThresholds[name]>game.rarityThresholds[thresholds[index-1]]))throw Error('invalidGameAdapter');
}
