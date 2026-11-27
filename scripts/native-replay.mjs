import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

export const replaySource1227=Object.freeze({
 sourceVersion:'1.0.1227',sourceUrl:'https://deepveinidle.com/assets/index-CAVhsVuf.js',
 sha256:'515ebeaa09cd97f97cc8365862746a70a93b1b7c3f247c9aeec2a7af5c43746d',
});

export const workModelSymbols1227=Object.freeze({
 tickMs:'mo',recipes:'xe',upgradeRecipes:'$m',items:'mc',item:'ie',recipeInputs:'tn',recipeOutput:'ry',
 itemSupportsRarity:'hb',rarityThresholds:'tr',hotRarityMultiplier:'P8',world:'X',siteEntrance:'Ts',walkPath:'NM',
 withRarity:'Te',baseItemId:'io',itemTier:'ee',upgradeMaterials:'bv',upgradeResult:'pb',
 levelSpeedCoefficient:'ZIo',upgradeBaseTicks:'Seo',bonusMinimumUncommon:'Ek',
 coinItemId:'ks',dungeonKeyTier:'iZ',dungeonKeyChance:'Nxo',dungeonKeyBaseTicks:'jxo',levelXp:'os',skillPet:'vZ',skillPetChance:'QO',
});

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function loadReplaySnapshot(snapshot,output,reviewedSources){
 const snapshotPath=path.resolve(snapshot),outputPath=path.resolve(output);
 const snapshotFile=statSync(snapshotPath,{bigint:true});
 function checkOutputPath(){
  const outputFile=statSync(outputPath,{bigint:true,throwIfNoEntry:false});
  assert.ok(!outputFile||snapshotFile.dev!==outputFile.dev||snapshotFile.ino!==outputFile.ino,
   'The output path must differ from the input snapshot.');
 }
 checkOutputPath();
 const bundle=readFileSync(snapshotPath),sha256=digest(bundle);
 const reviewed=reviewedSources.find(candidate=>candidate.sha256===sha256);
 if(!reviewed){
  const expected=reviewedSources.map(candidate=>`${candidate.sourceVersion} (${candidate.sha256})`).join(', ');
  throw Error(`Unreviewed snapshot SHA-256 ${sha256}. Expected ${expected}.`);
 }
 return {source:bundle.toString('utf8'),sourceVersion:reviewed.sourceVersion,sourceUrl:reviewed.sourceUrl,sha256,checkOutputPath};
}

export function sequenceArgs(rawSeedCount,rawCounts,rawStartSeed){
 function integer(value,minimum,label){
  const parsed=Number(value);
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(parsed)||parsed<minimum)throw Error(`Invalid ${label}.`);
  return parsed;
 }
 const seedCount=integer(rawSeedCount,1,'seed count');
 const counts=rawCounts.split(',').map(count=>integer(count,1,'action count'));
 const startSeed=integer(rawStartSeed,0,'starting seed');
 if(startSeed+seedCount-1>0xffffffff)throw Error('Seeds must fit in 32 unsigned bits.');
 return {seedCount,counts,startSeed,seeds:Array.from({length:seedCount},(_,index)=>index+startSeed)};
}

const globals=new Set(['WeakSet','WeakMap','Uint8Array','Uint16Array','Uint32Array','Int16Array','Int32Array',
 'Float64Array','Math','Map','Set','Number','Object','Array','String','Error','Date','Boolean','Infinity',
 'undefined','JSON','RegExp','parseInt','parseFloat','BigInt','NaN','structuredClone','console','Intl']);
const parseOptions={ecmaVersion:'latest',sourceType:'module',ranges:true};
function bindingNames(node){
 if(!node)return [];
 switch(node.type){
  case 'Identifier':return [node.name];
  case 'ObjectPattern':return node.properties.flatMap(property=>bindingNames(property.type==='RestElement'?property.argument:property.value));
  case 'ArrayPattern':return node.elements.flatMap(bindingNames);
  case 'RestElement':return bindingNames(node.argument);
  case 'AssignmentPattern':return bindingNames(node.left);
  default:return [];
 }
}

// Evaluate the reviewed declarations and their AST dependency closure.
export function extractNative(source,symbols,{initializers=[]}={}){
 const declarations=new Map(),requested=new Set(initializers),setup=[];
 for(const statement of parse(source,parseOptions).body){
  if(statement.type==='ExpressionStatement'&&requested.size){
   const expression=statement.expression,text=source.slice(expression.start,expression.end);
   if(requested.delete(text))setup.push({start:statement.start,text:text+';'});
  }
  const node=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
  if(!node)continue;
  for(const declaration of node.type==='VariableDeclaration'?node.declarations:[node]){
   if(!['VariableDeclarator','FunctionDeclaration','ClassDeclaration'].includes(declaration.type)||!declaration.id)continue;
   const text=source.slice(declaration.start,declaration.end);
   const entry={start:declaration.start,text:node.type==='VariableDeclaration'?`${node.kind} ${text};`:text};
   for(const name of bindingNames(declaration.id))declarations.set(name,entry);
  }
 }
 assert.equal(requested.size,0,'Missing reviewed initializer: '+[...requested].join(', '));
 const selected=new Set(),stack=[];
 function visit(declaration,symbol){
  if(selected.has(declaration))return;
  selected.add(declaration);
  stack.push(symbol);
  const scope=analyze(parse(declaration.text,parseOptions),{ecmaVersion:2024,sourceType:'module'});
  for(const reference of scope.globalScope.through){
   const dependency=reference.identifier.name;
   if(!globals.has(dependency))collect(dependency);
  }
  stack.pop();
 }
 function collect(symbol){
  const declaration=declarations.get(symbol);
  assert.ok(declaration,`Missing original declaration ${[...stack,symbol].join(' > ')}`);
  visit(declaration,symbol);
 }
 Object.values(symbols).forEach(collect);
 for(const entry of setup)visit(entry,'initializer');
 const defined=[...selected].sort((a,b)=>a.start-b.start).map(entry=>entry.text).join('\n');
 const native=Function(defined+'\nreturn {'+
  Object.entries(symbols).map(([name,symbol])=>`${JSON.stringify(name)}:${symbol}`).join(',')+'};')();
 return {native,declarationCount:selected.size};
}
