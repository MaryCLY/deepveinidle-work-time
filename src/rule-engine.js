import {validateAdapter,callRule} from './adapter.js';
import {createBatchTimeEstimator} from './batch-time.js';
import {createWorkExpectation} from './work-expectation.js';
export {batchTimeModel} from './batch-time.js';
export {gatheringSkills,toolSlots} from './domain.js';

export function createRuleEngine(game={}){
 validateAdapter(game);
 const estimateBatchTime=createBatchTimeEstimator(game);
 const {workActionSeconds,workQualities,estimateWorkExpectation}=createWorkExpectation(game);
 function estimateTaskTime(options){
  const {job,player,tier=0,discard=false,siteId}=options;
  const skillXp=player?.skills?.[job.skill];
  if(typeof skillXp!=='number'||!Number.isFinite(skillXp)||skillXp<0)throw Error('invalidWorkConfiguration');
  const level=callRule(game,'level','estimateTaskTime',skillXp);
  if(!Number.isFinite(level))throw Error('invalidWorkConfiguration');
  if(level<job.levelReq)return {status:'levelTooLow',seconds:null};
  const expectation=estimateWorkExpectation(options);
  if(expectation.status!=='ok')return {...expectation,seconds:null};
  const timing=estimateBatchTime({job,tier,count:expectation.attempts,player,actionSeconds:expectation.actionSeconds+expectation.waitSeconds,discard,siteId});
  return {...expectation,...timing};
 }
 return Object.freeze({estimateBatchTime,workActionSeconds,workQualities,estimateWorkExpectation,estimateTaskTime});
}
