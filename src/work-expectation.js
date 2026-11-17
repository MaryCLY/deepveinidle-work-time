import {gatheringSkills,toolSlots} from './domain.js';

const checked=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw Error('quantityOverflow');return value;};
const probability=value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('invalidResult');return value;};

export function createWorkExpectation(game){
 function workActionSeconds(job,player){
  if(job.upgrade){
   const ticks=game.upgradeTicks(player,job.upgrade);
   return Number.isFinite(ticks)&&ticks>=0?checked(ticks*game.tickMs/1000):null;
  }
  const chance=probability(game.workChance(job,player));
  return chance>0?checked(game.tickMs/1000/chance):null;
 }

 function workQualities(player,job,tick,worldRarity){
  if(job.plain)return [1,0,0,0,0];
  if(!Number.isSafeInteger(tick)||tick<0||!Number.isFinite(worldRarity)||worldRarity<0)throw Error('invalidWorkConfiguration');
  const equipped=player.equipment[toolSlots[job.skill]];
  const luck=(equipped==null?0:game.toolLuck(equipped))+game.equipmentLuck(player.equipment);
  const multiplier=(1+luck)*game.combine(1+worldRarity/100,game.brewRarityMultiplier(player),game.hotRarityMultiplier(tick,job.skill),game.houseRarityMultiplier(player),game.masteryMultiplier(player.masteries,'rare'));
  if(!Number.isFinite(multiplier)||multiplier<0)throw Error('invalidResult');
  const cumulative=['uncommon','rare','epic','legendary'].map(key=>Math.min(1,Math.max(0,game.rarityThresholds[key]*multiplier)));
  return [1-cumulative[0],cumulative[0]-cumulative[1],cumulative[1]-cumulative[2],cumulative[2]-cumulative[3],cumulative[3]];
 }

 function estimateWorkExpectation({job,tier=0,quantity,player,tick,worldRarity=0}){
  if(!Number.isFinite(quantity)||quantity<=0||quantity>Number.MAX_SAFE_INTEGER)throw Error('invalidQuantity');
  if(!Number.isInteger(tier)||tier<0||tier>4)throw Error('invalidTier');
  if(!Number.isSafeInteger(job?.output?.qty)||job.output.qty<=0)throw Error('invalidJob');
  const successes=Math.ceil(quantity/job.output.qty),output=checked(successes*job.output.qty);
  const actionSeconds=workActionSeconds(job,player);
  if(job.upgrade){
   return {status:actionSeconds===null?'unreachable':'ok',attempts:successes,quantity:output,burn:0,caught:0,quality:1,actionSeconds,waitSeconds:0};
  }
  const burn=probability(game.burnChance(job,player)),caught=probability(game.caughtChance(job,player));
  const gathering=gatheringSkills.includes(job.skill);
  const qualities=gathering&&game.itemSupportsRarity(job.output.itemId)?workQualities(player,job,tick,worldRarity):[1];
  const quality=gathering?(qualities[tier]??0):1,success=(1-burn)*(1-caught)*quality;
  const waitSeconds=checked(caught*Math.max(0,(job.caught?.stunTicks??0)-1)*game.tickMs/1000);
  if(actionSeconds===null||success<=0)return {status:'unreachable',attempts:null,quantity:output,burn,caught,quality,actionSeconds,waitSeconds};
  return {status:'ok',attempts:checked(successes/success),quantity:output,burn,caught,quality,actionSeconds,waitSeconds};
 }
 return {workActionSeconds,workQualities,estimateWorkExpectation};
}
