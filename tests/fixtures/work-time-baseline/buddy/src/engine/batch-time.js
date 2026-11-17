import * as game from './upstream.js';

// The phase transitions in pN / RN / WOo of the reviewed 1.0.1214 snapshot.
// This is an analytical approximation: initial pack is empty, all materials are
// available, the main-city warehouse is the origin, and the last batch is banked.
// Rare bonus drops and future level/brew changes do not alter batch capacity.
export const batchTimeModel=Object.freeze({sourceVersion:'1.0.1214',version:3,
 initialCraftTicks:5,initialGatherTicks:2,turnoverTicks:6,finishTicks:2,walkStartTicks:1});
const routes=new Map(),siteRoutes=new Map();
const checked=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw Error('quantityOverflow');return value;};
const unknown=(workSeconds,reason)=>({status:'unknownTime',seconds:null,workSeconds,overheadSeconds:null,batches:null,reason,sourceVersion:batchTimeModel.sourceVersion});

function routeLeg(from,target){
 // pN keeps the current tile when it already borders the destination. Otherwise
 // Ht chooses by Chebyshev proximity before k1 finds the actual walkable path.
 if(Math.abs(from.x-target.x)<=1&&Math.abs(from.y-target.y)<=1)return {point:from,distance:0};
 const point=game.siteEntrance(game.world,target.x,target.y,0,from);if(!point)return null;
 const path=game.walkPath(game.world,from.x,from.y,point.x,point.y);
 return path===null?null:{point,distance:path.length};
}

function siteRoute(site,bank,origin){
 if(siteRoutes.has(site.id))return siteRoutes.get(site.id);
 const legs=[],seen=new Map();let point=origin,route=null;
 // After each return the character occupies one of the depot's eight adjacent
 // tiles. Detect that finite state cycle once, independently of task quantity.
 for(;;){
  const key=`${point.x}:${point.y}`;
  if(seen.has(key)){
   const cycleStart=seen.get(key),cycle=legs.slice(cycleStart);
   route={siteId:site.id,bankId:bank.id,distance:legs[0].outwardDistance,returnDistance:legs[0].returnDistance,
    cycleStart,cycleLength:cycle.length,
    cycleOutwardDistance:cycle.reduce((sum,leg)=>sum+leg.outwardDistance,0),
    cycleReturnDistance:cycle.reduce((sum,leg)=>sum+leg.returnDistance,0),legs};
   route.cycleDistance=route.cycleOutwardDistance+route.cycleReturnDistance;break;
  }
  seen.set(key,legs.length);
  const outward=routeLeg(point,site);if(!outward)break;
  const returning=routeLeg(outward.point,bank);if(!returning)break;
  legs.push({bankStart:point,workPoint:outward.point,bankEnd:returning.point,
   outwardDistance:outward.distance,returnDistance:returning.distance});
  point=returning.point;
 }
 siteRoutes.set(site.id,route);return route;
}

function workRoute(jobId,siteId){
 // The task starts and finishes at the main-city depot, independent of the
 // character's current position or preferred bank. Its reviewed world ID is 1.
 const bank=game.world.bankById.get(1);if(!bank)return null;
 if(siteId!==undefined&&(!Number.isSafeInteger(siteId)||!game.world.siteById.get(siteId)?.jobIds.includes(jobId)))return null;
 const cacheKey=`${jobId}:${siteId??'default'}`;
 if(routes.has(cacheKey))return routes.get(cacheKey);
 const origin=game.siteEntrance(game.world,bank.x,bank.y,0);if(!origin)return null;
 let best=null;
 // Default selection minimizes the real first walk from this fixed origin;
 // the game UI can choose another site from the live character's position.
 for(const site of game.world.sites){
  if(!site.jobIds.includes(jobId)||siteId!==undefined&&site.id!==siteId)continue;
  const candidate=siteRoute(site,bank,origin);
  if(candidate&&(best===null||candidate.distance<best.distance||candidate.distance===best.distance&&candidate.siteId<best.siteId))best=candidate;
 }
 routes.set(cacheKey,best);return best;
}

function walking(route,batches,strideSpeed){
 // La resets stride on each new path; rounding the entire route would carry a
 // remainder across legs that Vko discards when the character arrives.
 const ticks=distance=>Math.ceil(distance*1000/strideSpeed);
 const costs=route.legs.map(leg=>({walk:ticks(leg.outwardDistance)+ticks(leg.returnDistance),
  starts:Number(leg.outwardDistance>0)+Number(leg.returnDistance>0)}));
 const sum=(start,end,key)=>costs.slice(start,end).reduce((total,cost)=>total+cost[key],0);
 const prefix=Math.min(batches,route.cycleStart),remaining=batches-prefix;
 const cycles=Math.floor(remaining/route.cycleLength),tail=remaining%route.cycleLength;
 const total=key=>checked(sum(0,prefix,key)+cycles*sum(route.cycleStart,costs.length,key)+sum(route.cycleStart,route.cycleStart+tail,key));
 return {walkTicks:ticks(route.distance),returnWalkTicks:ticks(route.returnDistance),totalWalkTicks:total('walk'),walkStarts:total('starts')};
}

function movement(player){
 if(!player||!Number.isInteger(player.perks?.pockets)||player.perks.pockets<0||player.perks.pockets>5
  ||!player.equipment||!Object.hasOwn(player.equipment,'mount')||!Number.isInteger(player.masteries?.move)||player.masteries.move<0||player.masteries.move>game.masteryRankLimit
  ||!player.brews||!player.brewTier||!Number.isSafeInteger(player.lastTick)||player.lastTick<0)return null;
 const mount=player.equipment.mount;
 if(mount!==null&&(!Number.isSafeInteger(mount)||game.tool(mount)?.slot!=='mount'))return null;
 const swiftUntil=player.brews.swift;
 if(swiftUntil!==undefined&&(!Number.isSafeInteger(swiftUntil)||swiftUntil<0))return null;
 if(swiftUntil>player.lastTick&&(!Number.isInteger(player.brewTier.swift)||player.brewTier.swift<0||player.brewTier.swift>4))return null;
 const strideSpeed=Math.round(game.mountStride(player)*(1+game.swiftSpeedBonus*game.brewStrength(player,'swift'))*game.masteryMultiplier(player.masteries,'move'));
 return Number.isFinite(strideSpeed)&&strideSpeed>0?{strideSpeed,slots:game.inventoryCapacity(player)}:null;
}

function capacity(job,tier,slots){
 // q_ limits how many inputs the game withdraws, including a reserved output stack.
 // This may be lower than the theoretical limit after consuming the first inputs.
 const inputs=game.recipeInputs(job,tier),nonstacked=inputs.filter(input=>!game.item(input.itemId).stackable).reduce((sum,input)=>sum+input.qty,0);
 const stacks=new Set(inputs.filter(input=>game.item(input.itemId).stackable).map(input=>input.itemId)).size;
 const stackedOutput=game.item(game.recipeOutput(job,tier)).stackable;
 if(nonstacked>0)return Math.floor((slots-stacks-(stackedOutput?1:0))/nonstacked);
 if(stackedOutput)return slots>=stacks+1?Infinity:0;
 return Math.floor((slots-stacks)/job.output.qty);
}

export function estimateBatchTime({job,tier=0,count,player,actionSeconds,discard=false,siteId}){
 if(!Number.isFinite(count)||count<=0||count>Number.MAX_SAFE_INTEGER)throw Error('invalidQuantity');
 if(!Number.isFinite(actionSeconds)||actionSeconds<0)return unknown(null,'actionTime');
 const workSeconds=checked(count*actionSeconds),base={workSeconds,sourceVersion:batchTimeModel.sourceVersion};
 if(discard||job.skill==='thieving'||job.upgrade)return {...base,status:'ok',seconds:workSeconds,overheadSeconds:0,batches:0,batchCapacity:null};
 const travel=movement(player);if(!travel)return unknown(workSeconds,'movementConfiguration');
 const route=workRoute(job.id,siteId);if(!route)return unknown(workSeconds,'workLocation');
 const batchCapacity=capacity(job,tier,travel.slots);
 if(batchCapacity<=0)return {...base,status:'unreachable',seconds:null,overheadSeconds:null,batches:null,batchCapacity};
 const batches=batchCapacity===Infinity?1:Math.ceil(Math.ceil(count)/batchCapacity);
 const walks=walking(route,batches,travel.strideSpeed);
 const initialTicks=job.inputs.length?batchTimeModel.initialCraftTicks:batchTimeModel.initialGatherTicks;
 const overheadSeconds=checked((initialTicks+batchTimeModel.finishTicks+(batches-1)*batchTimeModel.turnoverTicks+walks.totalWalkTicks+walks.walkStarts*batchTimeModel.walkStartTicks)*game.tickMs/1000);
 const {legs,...geometry}=route;
 return {...base,...geometry,...travel,...walks,originAssumption:'main-city-bank',status:'ok',seconds:checked(workSeconds+overheadSeconds),overheadSeconds,batches,batchCapacity:batchCapacity===Infinity?null:batchCapacity};
}

export function estimateWorkTime(state,job,tier,count,players,{discard=state.discardProducts??false,actionSeconds,siteId}={}){
 if(!state.initialized)return {status:'uninitialized',seconds:null};
 if(state.config.levels[job.skill]<job.levelReq)return {status:'levelTooLow',seconds:null};
 const player=players?.bySkill?.[job.skill];
 if(!player)return unknown(null,'workConfiguration');
 if(actionSeconds===undefined){
  if(job.upgrade)actionSeconds=game.upgradeTicks(player,job.upgrade)*game.tickMs/1000;
  else{
   const chance=game.workChance(job,player);
   if(!Number.isFinite(chance)||chance<=0)return {status:'unreachable',seconds:null};
   actionSeconds=game.tickMs/1000/chance;
  }
 }
 return estimateBatchTime({job,tier,count,player,actionSeconds,discard,siteId});
}
