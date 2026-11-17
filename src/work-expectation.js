import {gatheringSkills,toolSlots} from './domain.js';
import {callRule,requireCapability,tickMilliseconds} from './adapter.js';

const checked=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw Error('quantityOverflow');return value;};
const probability=value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('invalidResult');return value;};
const finiteResult=value=>{if(!Number.isFinite(value))throw Error('invalidResult');return value;};

export function createWorkExpectation(game){
 function workActionSeconds(job,player){
  const feature='workActionSeconds';
  if(job.upgrade){
   const ticks=callRule(game,'upgradeTicks',feature,player,job.upgrade);
   return Number.isFinite(ticks)&&ticks>=0?checked(ticks*tickMilliseconds(game,feature)/1000):null;
  }
  const chance=probability(callRule(game,'workChance',feature,job,player));
  return chance>0?checked(tickMilliseconds(game,feature)/1000/chance):null;
 }

 function workQualities(player,job,tick,worldRarity){
  if(job.plain)return [1,0,0,0,0];
  const feature='workQualities',keys=['uncommon','rare','epic','legendary'],thresholds=game.rarityThresholds;
  requireCapability(keys.every((key,index)=>Number.isFinite(thresholds?.[key])&&thresholds[key]>=0&&thresholds[key]<=1
   &&(index===0||thresholds[key]<=thresholds[keys[index-1]])),feature,'rarityThresholds');
  if(!Number.isSafeInteger(tick)||tick<0||!Number.isFinite(worldRarity)||worldRarity<0||!player?.equipment)throw Error('invalidWorkConfiguration');
  const equipped=player.equipment[toolSlots[job.skill]];
  const luck=(equipped==null?0:finiteResult(callRule(game,'toolLuck',feature,equipped)))+finiteResult(callRule(game,'equipmentLuck',feature,player.equipment));
  const multipliers=[1+worldRarity/100,
   callRule(game,'brewRarityMultiplier',feature,player),callRule(game,'hotRarityMultiplier',feature,tick,job.skill),
   callRule(game,'houseRarityMultiplier',feature,player),callRule(game,'masteryMultiplier',feature,player.masteries,'rare')];
  if(multipliers.some(value=>!Number.isFinite(value)||value<0))throw Error('invalidResult');
  const multiplier=(1+luck)*finiteResult(callRule(game,'combine',feature,...multipliers));
  if(!Number.isFinite(multiplier)||multiplier<0)throw Error('invalidResult');
  const cumulative=keys.map(key=>Math.min(1,Math.max(0,thresholds[key]*multiplier)));
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
  if(actionSeconds===null)return {status:'unreachable',attempts:null,quantity:output,burn:null,caught:null,quality:null,actionSeconds:null,waitSeconds:null};
  const feature='estimateWorkExpectation';
  const burn=probability(callRule(game,'burnChance',feature,job,player)),caught=probability(callRule(game,'caughtChance',feature,job,player));
  const gathering=gatheringSkills.includes(job.skill);
  let qualities=[1];
  if(gathering){
   if(job.plain)qualities=[1,0,0,0,0];
   else{
    const supportsRarity=callRule(game,'itemSupportsRarity',feature,job.output.itemId);
    if(typeof supportsRarity!=='boolean')throw Error('invalidResult');
    if(supportsRarity)qualities=workQualities(player,job,tick,worldRarity);
   }
  }
  const quality=gathering?(qualities[tier]??0):1,success=(1-burn)*(1-caught)*quality;
  let waitTicks=0;
  if(caught>0){
   const stunTicks=job.caught?.stunTicks??0;
   if(!Number.isFinite(stunTicks)||stunTicks<0||stunTicks>Number.MAX_SAFE_INTEGER)throw Error('invalidResult');
   waitTicks=Math.max(0,stunTicks-1);
  }
  const waitSeconds=waitTicks>0?checked(caught*waitTicks*tickMilliseconds(game,feature)/1000):0;
  if(success<=0)return {status:'unreachable',attempts:null,quantity:output,burn,caught,quality,actionSeconds,waitSeconds};
  return {status:'ok',attempts:checked(successes/success),quantity:output,burn,caught,quality,actionSeconds,waitSeconds};
 }
 return {workActionSeconds,workQualities,estimateWorkExpectation};
}
