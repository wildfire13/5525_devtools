'use strict';
const {verifyRoundtrip} = require('./save-validation.cjs');
const {gameModule, sourceSha} = require('./game-source.cjs');
// Each invocation uses the verified game revision selected for this workspace.
const C=gameModule('campaign.js');
const B=gameModule('campaign-battle.js');
const S=gameModule('equipment-slots.js');
const E=gameModule('equipment-skills.js');
const {isDeepStrictEqual}=require('node:util');
const Envelope=require('./metadata-envelope.cjs');
const Timeline=require('./quest-timeline.cjs');
const QA=require('./qa-fixtures.cjs');
const fail=m=>{throw new Error(m)};
function record(v,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)fail(label+' must be an object');}
function keys(v,allowed,label){record(v,label);for(const k of Object.keys(v))if(!allowed.includes(k))fail(label+': unsupported key '+k);}
function integer(v,label){if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(label+' must be an integer from 0 to 100000000');return v;}
function checked(state, extras = {}) {
  const {raw} = verifyRoundtrip(state, 'Save changed during reload verification');
  return Envelope.join(JSON.parse(raw), extras);
}
function editable(s){return s.phase==='town'&&!s.activeQuest&&!s.rollback&&!s.journey&&!s.battle&&!s.result;}
function inspectState(s){
 const view=C.view(s);
 return {sourceSha,summary:{phase:s.phase,location:s.location,gold:s.gold,hours:s.hours,worldTime:s.worldTime,level:s.level,partyRP:s.partyRP||0,editable:editable(s)},members:view.roster.map(r=>({id:r.id,name:r.name,job:r.job,role:r.role,selected:s.selected.includes(r.id),level:r.level,xp:r.xp,hp:r.hp,mp:r.mp,statPoints:r.statPoints,skillPoints:r.skillPoints,allocations:r.allocations,stats:r.stats,equipment:r.stats.equipment,skills:r.stats.skillSources.map(x=>({...x,name:E.definitions[x.id]?.name||view.skillNames[x.id]||x.id,source:x.slot+':'+x.itemId}))})),warnings:[...(!editable(s)?['この進行状態は閲覧・比較専用です。未受注の街のセーブのみ編集できます。']:[]),'数値は固定コミットの実装値です。最終バランスや戦闘結果を保証しません。']};
}
function inspectEnvelope(save){
 const parts=Envelope.split(save),info=inspectState(C.deserialize(parts.core));
 info.metadata=Envelope.summary(parts.extras);
 if(info.metadata.preservedKeys.length)info.warnings.push('Godot付加情報と立ち絵'+info.metadata.portraits+'件を保持。画像や画面設定は編集しません');
 return info;
}
function edit(save,patch){
 const parts=Envelope.split(save),s=C.deserialize(parts.core);if(!editable(s))fail('未受注の街のセーブのみ編集できます');keys(patch,['gold','characters'],'patch');
 if(Object.hasOwn(patch,'gold'))s.gold=integer(patch.gold,'gold');
 if(Object.hasOwn(patch,'characters')){
  record(patch.characters,'characters');
  for(const [id,p] of Object.entries(patch.characters)){
   if(!Object.hasOwn(s.characters,id))fail('Unknown character '+id);
   keys(p,['xp','hp','mp','allocations','equipment'],'character patch');const c=s.characters[id];
   if(Object.hasOwn(p,'xp')){c.xp=integer(p.xp,'xp');c.level=1+Math.floor(c.xp/100);c.skillPoints=c.level-1;}
   if(Object.hasOwn(p,'allocations')){keys(p.allocations,['str','int','agi'],'allocations');for(const [k,v] of Object.entries(p.allocations))c.allocations[k]=integer(v,k);}
   c.statPoints=(c.level-1)*2-Object.values(c.allocations).reduce((a,b)=>a+b,0);if(c.statPoints<0)fail('XP is too low for the allocated stat points');
   if(Object.hasOwn(p,'equipment')){
    keys(p.equipment,Object.keys(S.slots),'equipment');
    const old=C.equipment(c);
    for(const [slot,gearId] of Object.entries(p.equipment)){
     const g=C.gear.find(g=>g.id===gearId);if(!g||!S.allowed(g).includes(slot))fail('Equipment does not fit '+slot);
     if(g.virtualDefault)fail('Virtual equipment cannot be stored');
     const previous=C.gear.find(g=>g.id===old[slot]);if(previous?.removable===false&&previous.id!==gearId)fail('This equipment cannot be removed');
     c[S.storage(slot)]=gearId;
    }
    for(const [slot,gearId] of Object.entries(p.equipment)){
     // The official shop quote forbids touching an occupied left hand, even
     // when a full-form patch retains its canonical empty marker. This is a
     // saved-state patch, not a purchase: leave that marker to final validation.
     if(slot==='leftHand'&&gearId==='empty-leftHand'&&C.gear.find(g=>g.id===c.weapon)?.hands===2)continue;
     const q=C.quote(s,id,gearId,slot);if(!q?.eligible)fail(q?.reason||'Invalid equipment');
    }
   }
   if(Object.hasOwn(p,'hp'))c.hp=integer(p.hp,'hp');if(Object.hasOwn(p,'mp'))c.mp=integer(p.mp,'mp');
  }
 }
 return checked(s,parts.extras);
}
function compare(before,after){
 const a=inspectEnvelope(before),b=inspectEnvelope(after),rows=[];
 function add(subject,field,x,y){if(JSON.stringify(x)===JSON.stringify(y))return;rows.push({subject,field,before:x??null,after:y??null,...(typeof x==='number'&&typeof y==='number'?{delta:y-x}:{})});}
 for(const k of Object.keys({...a.summary,...b.summary}))add('campaign',k,a.summary[k],b.summary[k]);
 const am=new Map(a.members.map(m=>[m.id,m])),bm=new Map(b.members.map(m=>[m.id,m]));
 for(const id of new Set([...am.keys(),...bm.keys()])){const x=am.get(id),y=bm.get(id);if(!x||!y){add(id,'member',x,y);continue;}for(const k of ['level','xp','hp','mp','statPoints','skillPoints'])add(id,k,x[k],y[k]);for(const k of Object.keys({...x.stats,...y.stats}))add(id,'stats.'+k,x.stats[k],y.stats[k]);for(const k of Object.keys(S.slots))add(id,'equipment.'+k,x.equipment[k],y.equipment[k]);add(id,'skills',x.skills,y.skills);}
 return {sourceSha,rows,before:a,after:b};
}
function run(r){
 record(r,'request');
 const allowed={new:['cmd'],catalog:['cmd'],normalize:['cmd','save'],inspect:['cmd','save'],edit:['cmd','save','patch'],compare:['cmd','before','after'],timeline:['cmd','save','options'],boundaries:['cmd','save','options'],'qa-catalog':['cmd'],'qa-fixtures':['cmd','options']};
 if(!Object.hasOwn(allowed,r.cmd))fail('Unsupported command');
 keys(r,allowed[r.cmd],'request');
 switch(r.cmd){case 'boundaries':return Timeline.boundaryComparison(r.save,r.options);case 'qa-catalog':return QA.catalog();case 'qa-fixtures':return QA.fixtures(r.options);case 'timeline':return Timeline.timeline(r.save,r.options);case 'new':return checked(C.create());case 'catalog':return {sourceSha,gear:C.gear.map(g=>({...g,allowedSlots:S.allowed(g)})),slots:S.slots,characters:B.roster.map(({id,name,job})=>({id,name,job}))};case 'normalize':{const parts=Envelope.split(r.save),save=checked(C.deserialize(parts.core),parts.extras),original=parts.original;const migrated=!isDeepStrictEqual(original,save);return {save,migrated,warnings:migrated?['読込時に公式移行を適用。原本Aは移行後を比較基準にしています。元ファイルは未変更']:[]};}case 'inspect':return inspectEnvelope(r.save);case 'edit':return edit(r.save,r.patch);case 'compare':return compare(r.before,r.after);default:fail('Unsupported command');}}
module.exports={run,sourceSha};
if(require.main===module)require('node:readline').createInterface({input:process.stdin}).on('line',line=>{try{if(Buffer.byteLength(line)>4*C.MAX_SAVE_BYTES)fail('Request is too large');console.log(JSON.stringify({ok:true,result:run(JSON.parse(line))}));}catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}});
