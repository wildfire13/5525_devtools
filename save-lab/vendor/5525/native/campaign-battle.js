"use strict";
// Campaign-only extension of frozen battle.js (source sha256 documented in README).
// Optional equippedSkill changes the active command, never the character job.
// Unextended standalone/journey continue using battle.js.
const Presentation = require('./battle-presentation.cjs');
const Battle = (() => {
  const {definitions:equipmentSkills}=require('./equipment-skills.js');
  const hasEffect=(a,id)=>(a.effects||[]).includes(id);
  // Equipped contributions remain distinct. Legacy standalone fixtures have
  // no source metadata and retain one contribution per enabled effect.
  const effectCount=(a,id)=>Array.isArray(a.skillSources)?a.skillSources.filter(x=>x.id===id).length:(hasEffect(a,id)?1:0);
  const percentageIncrease=(a,id,percent)=>effectCount(a,id)*percent;
  const evasionChance=a=>Math.min(1,percentageIncrease(a,'evasion',10)/100);

  const moveReach=a=>(hasEffect(a,'firstStride')&&!a.firstMoveUsed?3:2)+(hasEffect(a,'swift')?1:0);
  const skillCost=a=>['archer','scout'].includes(activeSkill(a))&&skillLevel(a)>=3?2:(equipmentSkills[activeSkill(a)]?.cost??1);
  const snipeExtension=a=>[1,1.5,2][Math.min(3,skillLevel(a,'archer'))-1];
  function itemCount(s,a,id) {
    if(a.side==='ally'&&s.itemInventories)return s.itemInventories[a.id]?.[id]||0;
    if(a.side==='enemy'&&a.inventory)return a.inventory[id]||0;
    return id==='ether'?(s.ethers||0):(s.potions[a.side]||0);
  }
  function consumeItem(s,a,id) {
    if(a.side==='ally'&&s.itemInventories)s.itemInventories[a.id][id]--;
    else if(a.side==='enemy'&&a.inventory){a.inventory[id]--;return;}
    if(id==='ether')s.ethers--;else s.potions[a.side]--;
  }
  function emit(s,a,id,details={}) {
    s.skillEventSequence=(s.skillEventSequence||0)+1;
    (s.skillEvents||(s.skillEvents=[])).push({sequence:s.skillEventSequence,type:'skill.activated',actorId:a.id,skillId:id,classification:equipmentSkills[id].classification,...details});
    if(s.skillEvents.length>100)s.skillEvents.splice(0,s.skillEvents.length-100);
  }
  function freeCell(s,p){return Number.isInteger(p)&&p>=0&&p<50&&!alive(s).some(u=>u.pos===p);}
  function retreatCell(s,a){const p=a.pos+(a.side==='ally'?-1:1);return y(p)===y(a.pos)&&freeCell(s,p)&&canEnter(a,p)?p:null;}
  function crossCells(p){return [p,...[p-1,p+1,p-10,p+10].filter(q=>q>=0&&q<50&&range({pos:p},{pos:q})===1)];}
  function skillTargets(s,a,kind='skill') {
    if(kind==='return')return Array.from({length:50},(_,p)=>p).filter(p=>legalFor(s,a,kind,p));
    const id=activeSkill(a),d=equipmentSkills[id];
    if(d?.target==='pair'||d?.target==='upToTwo'){
      const candidates=alive(s).filter(b=>b.id!==a.id&&inRange(a,b.side,b.pos,'skill',s));
      const targets=d.target==='upToTwo'?candidates.map(b=>[b.id]):[];
      for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)targets.push([candidates[i].id,candidates[j].id]);
      return targets.filter(t=>legalFor(s,a,'skill',t));
    }
    const targets=id==='stamp'||d?.target==='cell'?Array.from({length:50},(_,p)=>p):s.units.map(u=>u.id);
    return targets.filter(t=>legalFor(s,a,'skill',t));
  }
  // Weapon ATK excludes template ATK and growth; growth is added once after filtering.
  function reachFilteredPower(a,target,kind='attack') {
    if(a.job==='porter')return {base:0,weapons:[],bonus:0};
    if(!a.attackWeapons)return {base:a.atk,weapons:[],bonus:0,components:{physical:a.atk,fire:a.atkFire||0,water:a.atkWater||0,earth:a.atkEarth||0}};
    const skill=kind==='skill'?activeSkill(a):null;
    const weapons=a.attackWeapons.filter(w=>skill==='spearThrow'?w.slot===selectedSkillOption(a)?.slot&&range(a,target)===4:range(a,target)<=w.reach+(skill==='archer'?snipeExtension(a):0)||(skill==='stamp'&&(w.skill==='stamp'||(a.skillSources||[]).some(source=>source.id==='stamp'&&source.slot===w.slot&&source.itemId===w.itemId))));
    const bonus=weapons.length?(a.attackBonus||0):0;
    const components={physical:weapons.reduce((n,w)=>n+w.atk,0)+bonus,fire:weapons.reduce((n,w)=>n+(w.atkFire||0),0),water:weapons.reduce((n,w)=>n+(w.atkWater||0),0),earth:weapons.reduce((n,w)=>n+(w.atkEarth||0),0)};
    return {base:Object.values(components).reduce((n,v)=>n+v,0),weapons,bonus,components};
  }
  function power(s,a,base=a.atk,emitEvent=true){
    let p=formation(s,a.side)?boosted(s,a.side)?1.75:1.5:1;
    if(hasEffect(a,'loneWolf')&&!alive(s).some(u=>u.side===a.side&&u.id!==a.id&&range(a,u)===1)){
      p*=1+percentageIncrease(a,'loneWolf',25)/100;if(emitEvent)emit(s,a,'loneWolf');
    }
    return typeof base==='number'?base*p:Object.fromEntries(Object.entries(base).map(([key,value])=>[key,value*p]));
  }
  // Display history is independent of PlayLog diagnostic retention. Leave the
  // counter absent until the first eviction to preserve short-battle parity.
  const MAX_LOG_LINES = 1000;
  function trimLog(s) {
    const dropped=Math.max(0,s.log.length-MAX_LOG_LINES);
    if(dropped){s.log.splice(0,dropped);s.logDropped=(s.logDropped||0)+dropped;}
  }
  function log(s,message) {s.log.push(message);trimLog(s);}
  // 全員の位置は共通10×5座標。所属(side)と滞在陣地は独立。
  const x = p => p % 10, y = p => Math.floor(p / 10);
  const alive = s => s.units.filter(u => u.hp > 0);
  const range = (a,b) => Math.abs(x(a.pos)-x(b.pos))+Math.abs(y(a.pos)-y(b.pos));
  const boardOf = p => x(p)<5 ? "ally" : "enemy";
  const cell = (board,p) => Math.floor(p/5)*10 + p%5 + (board==='enemy'?5:0);
  const screen = (_,p) => ({x:x(p)%5,y:y(p)});
  const slots = {ally:[24,13,33],enemy:[25,16,36]};
  // R04: unversioned standalone fixtures retain their original rules. Product
  // campaigns explicitly create version 2; loaded running legacy battles use 1.
  const formationSlots = s => ({ally:s.formationVersion===2&&s.formationKind==='convoy'?[23,12,32]:[...slots.ally],enemy:[...slots.enemy]});
  const formation = (s,side="ally") => formationSlots(s)[side].every(p=>alive(s).some(u=>u.side===side&&u.pos===p));
  // 仮接続：槌装備でスタンプを試せる。完成版の習得・使用条件は未決定。
  const activeSkills = a => a.activeSkills||[a.job==='porter'?'porter':(a.equippedSkill || (a.weapon==='hammer'?'stamp':a.job))];
  // A grant has an identity independent of the shared effect definition.
  // The slot ordinal also distinguishes repeated grants within one item.
  function grantOptions(a,ids) {
    const occurrences=new Map(),options=[];
    for(const source of a.skillSources||[]){
      const owner=JSON.stringify([source.slot||'',source.itemId||'']);
      const ordinal=(occurrences.get(owner)||0)+1;occurrences.set(owner,ordinal);
      if(!ids.includes(source.id))continue;
      const grantSlot=source.grantSlot??ordinal;
      const key=JSON.stringify([source.slot||'',source.itemId||'',grantSlot]);
      options.push({key,id:source.id,level:source.level??1,slot:source.slot||'',itemId:source.itemId||'',grantSlot,cooldown:a.skillCooldowns?.[key]||0});
    }
    for(const id of ids)if(!options.some(o=>o.id===id)){
      const key='legacy:'+id;options.push({key,id,level:1,slot:'',itemId:'',grantSlot:1,cooldown:a.skillCooldowns?.[key]||0});
    }
    return options.sort((left,right)=>ids.indexOf(left.id)-ids.indexOf(right.id));
  }
  const activeSkillOptions=a=>grantOptions(a,activeSkills(a));
  const returnSkillOptions=a=>grantOptions(a,hasEffect(a,'returnHome')?['returnHome']:[]).map(option=>({...option,used:a.returnUsedGrants?!!a.returnUsedGrants[option.key]:!!a.returnUsed}));
  function returnSkillOption(a){const options=returnSkillOptions(a);return options.find(o=>o.key===a.selectedReturnSkillKey)||options[0]||null;}
  function selectReturnSkill(s,key){
    const a=s.units.find(u=>u.id===s.actor);
    if(s.deploying||s.result||!a||a.hp<=0||a.pendingStamp)return false;
    const options=returnSkillOptions(a),option=options.find(o=>o.key===key)||(key==='returnHome'?options[0]:null);
    if(!option)return false;a.selectedReturnSkillKey=option.key;return true;
  }
  function selectedSkillOption(a) {
    const options=activeSkillOptions(a);
    return options.find(o=>o.key===a.selectedSkillKey&&o.id===a.selectedSkill)||options.find(o=>o.id===a.selectedSkill)||options[0]||null;
  }
  const activeSkill = a => selectedSkillOption(a)?.id||null;
  function selectSkill(s,id){
    const a=s.units.find(u=>u.id===s.actor);
    if(s.deploying||s.result||!a||a.hp<=0||a.pendingStamp)return false;
    const options=activeSkillOptions(a),option=options.find(o=>o.key===id)||options.find(o=>o.id===id);
    if(!option)return false;
    a.selectedSkill=option.id;a.selectedSkillKey=option.key;return true;
  }
  const skillName = a => equipmentSkills[activeSkill(a)]?.name||({guard:"かばう",archer:"スナイプ",mage:"ヒール",scout:"奇襲",porter:"陣形強化",stamp:"スタンプ"})[activeSkill(a)]||'';
  function skillLevel(a,id=activeSkill(a)) {
    const selected=selectedSkillOption(a);
    return selected?.id===id?selected.level:activeSkillOptions(a).find(o=>o.id===id)?.level||1;
  }
  function itemSkillOption(a) {
    const selected=selectedSkillOption(a);
    const options=grantOptions(a,(a.skillSources||[]).some(source=>source.id==='itemUse')?['itemUse']:[]);
    return options.sort((left,right)=>right.level-left.level)[0]||null;
  }
  function actionSkillOption(a,kind) {
    return kind==='skill'?selectedSkillOption(a):['item','ether'].includes(kind)?itemSkillOption(a):null;
  }
  function startSkillCooldown(s,a,kind) {
    if(s.skillCooldownVersion!==1||['item','ether'].includes(kind)||kind==='skill'&&activeSkill(a)==='spearThrow')return;
    const option=actionSkillOption(a,kind);
    if(option)(a.skillCooldowns||(a.skillCooldowns={}))[option.key]=2;
  }
  function finishOpportunity(a) {
    if(!a.skillCooldowns)return;
    for(const key of Object.keys(a.skillCooldowns)){
      if(a.skillCooldowns[key]>1)a.skillCooldowns[key]--;
      else delete a.skillCooldowns[key];
    }
    if(!Object.keys(a.skillCooldowns).length)delete a.skillCooldowns;
  }
  function itemUseLevel(a) {
    // Campaign equipment requires a fist in at least one hand. Old standalone
    // battles without equipment metadata retain their original rules.
    if(a.side==='ally'&&a.equipment&&!['rightHand','leftHand'].some(slot=>(a.skillSources||[]).some(source=>source.id==='itemUse'&&source.slot===slot&&(source.itemId===`empty-${slot}`||/^fist(?:-[12])?$/.test(source.itemId||'')))))return 0;
    return a.side!=='ally'||a.skillSources===undefined?3:itemSkillOption(a)?.level||0;
  }
  function itemInRange(a,b) {
    const level=itemUseLevel(a);
    return b.side===a.side&&(level>=3||level===2&&range(a,b)<=1||level===1&&a.id===b.id);
  }
  function grappleCell(a,b) {
    return b.hp>0&&y(b.pos)===y(a.pos)&&x(b.pos)-x(a.pos)===2?b.pos-1:null;
  }
  function sweepCells(a) {
    return Array.from({length:50},(_,p)=>p).filter(p=>p!==a.pos&&Math.abs(x(p)-x(a.pos))<=1&&Math.abs(y(p)-y(a.pos))<=1);
  }
  const sweepChance=a=>[.5,.75,1][Math.min(3,skillLevel(a,'legSweep'))-1];
  const sweepTargets=(s,a)=>alive(s).filter(u=>u.side!==a.side&&sweepCells(a).includes(u.pos));
  function vaultCell(s,a,p) {
    return canEnter(a,p)&&range(a,{pos:p})===2&&(x(a.pos)===x(p)||y(a.pos)===y(p))&&freeCell(s,p);
  }
  function skillInfo(a) {
    if(activeSkill(a)==='archer')return {name:'スナイプ',level:skillLevel(a),cost:skillCost(a),target:'unit',reach:attackReach(a,'skill'),description:`各武器の射程をこの一撃だけ+${snipeExtension(a)}。届く武器のATKを合算。MP${skillCost(a)}。`};
    if(activeSkill(a)==='stamp')return {name:'スタンプ',level:1,cost:1,target:'cell',description:'右隣と、その上下の計3マスを指定。次の本人の行動で指定マスへ発動。対象を追尾せず、構え開始時にMP1を消費し、中断しても戻らない。使用後は次の本人の行動1回再使用不可。'};
    if(activeSkill(a)!=='scout'){const d=equipmentSkills[activeSkill(a)];return d?{...d,level:skillLevel(a)}:null;}
    const level=skillLevel(a);
    return {name:'奇襲',level,cost:skillCost(a),target:'unit',description:'奇襲Lv'+level+': '+(level===1?'前方のみ（味方は右、敵は左）':level===2?'同じ横列の左右':'上下左右の直線')+'。遮るキャラなしで手前に着地し、距離1の通常攻撃相当。MP'+skillCost(a)+'。'};
  }
  function attackReach(a,kind='attack') {
    const skill=kind==='skill'?activeSkill(a):null;
    // Support skills have their own specified reach, independent of hand order.
    if(skill==='guard')return 1;
    if(skill==='mage')return 2;
    if(skill==='spearThrow')return 4;
    if((kind==='attack'||skill==='archer')&&a.attackWeapons)return Math.max(0,...a.attackWeapons.map(w=>w.reach+(skill==='archer'?snipeExtension(a):0)));
    if(skill&&equipmentSkills[skill])return equipmentSkills[skill].reach;
    return a.reach+(skill==='archer'?snipeExtension(a):0);
  }
  function stampCells(a,center) {
    if(!Number.isInteger(center)||center<0||center>=50||x(a.pos)>=9||center!==a.pos+1)return [];
    const dx=x(center)-x(a.pos),dy=y(center)-y(a.pos);
    return [-1,0,1].map(offset=>({x:x(center)+(dy?offset:0),y:y(center)+(dx?offset:0)}))
      .filter(p=>p.x>=0&&p.x<10&&p.y>=0&&p.y<5).map(p=>p.y*10+p.x);
  }
  const boosted=(s,side='ally')=>formation(s,side)&&alive(s).some(u=>u.side===side&&u.boost);
  const templates = [
    {job:"guard",name:"ガロ",role:"盾役",icon:"盾",pos:24,max:180,atk:26,agi:10,reach:1,mp:6,image:"knight.png"},
    {job:"archer",name:"リノ",role:"弓手",icon:"弓",pos:13,max:100,atk:25,agi:14,reach:3,mp:4,image:"archer.png"},
    {job:"mage",name:"ミオ",role:"ヒーラー",icon:"癒",pos:33,max:100,atk:14,agi:11,reach:2,mp:8,image:"healer.png"},
    {job:"scout",name:"ニカ",role:"スカウト",icon:"斥",pos:4,max:105,atk:23,agi:13,reach:1,mp:5,image:"scout.png"},
    {job:"porter",name:"トワ",role:"ポーター",icon:"運",pos:22,max:110,atk:0,agi:12,reach:0,mp:6,image:"porter.png"},
    {job:"warrior",name:"槌戦士（仮）",role:"槌戦士",icon:"槌",weapon:"hammer",pos:24,max:180,atk:26,agi:10,reach:1,mp:6,image:"warrior.png"}
  ];
  const legacyRoster=templates.flatMap((t,i)=>t.job==='warrior'?[{...t,id:t.job}]:[{...t,id:t.job},{...t,id:t.job+'-2',name:['バルト','セナ','ユイ','ルカ','ハル'][i]}]);
  const recruitRoster=require('./recruit-roster.js')(templates);
  const roster=[...legacyRoster,...recruitRoster];
  const defaultJobs=['guard','archer','mage','scout'];
  function swapTarget(s,a,p){
    if(a.job!=='porter'||!canEnter(a,p)||p===a.pos)return null;
    const b=alive(s).find(u=>u.side===a.side&&u.id!==a.id&&u.pos===p);
    if(!b||!canEnter(b,a.pos))return null;
    return paths({...s,units:s.units.filter(u=>u.id!==b.id)},a,moveReach(a)).has(p)?b:null;
  }
  const canEnter = (a,p) => Number.isInteger(p)&&p>=0&&p<50&&((a.canInvade??(a.job==='scout'))||boardOf(p)===a.side);
  function paths(s,a,max=49) {
    const occupied=new Set(alive(s).filter(u=>u.id!==a.id).map(u=>u.pos));
    const found=new Map([[a.pos,[]]]), queue=[a.pos];
    for(let i=0;i<queue.length;i++) {
      const p=queue[i], route=found.get(p);
      if(route.length>=max)continue;
      for(const q of [x(p)>0?p-1:-1,x(p)<9?p+1:-1,y(p)>0?p-10:-1,y(p)<4?p+10:-1]) {
        if(!canEnter(a,q)||occupied.has(q)||found.has(q))continue;
        found.set(q,[...route,q]);queue.push(q);
      }
    }
    return found;
  }
  function ambush(s,a,b) {
    if(!b||activeSkill(a)!=='scout'||a.side===b.side||b.hp<=0)return null;
    const level=skillLevel(a),horizontal=y(a.pos)===y(b.pos),vertical=x(a.pos)===x(b.pos);
    if(!level||!horizontal&&!(level>=3&&vertical))return null;
    const direction=horizontal?Math.sign(x(b.pos)-x(a.pos)):Math.sign(y(b.pos)-y(a.pos));
    if(!direction||level===1&&direction!==(a.side==='ally'?1:-1))return null;
    const step=direction*(horizontal?1:10),destination=b.pos-step, route=[];
    if(!canEnter(a,destination))return null;
    for(let p=a.pos+step;p!==b.pos;p+=step){
      if(alive(s).some(u=>u.id!==a.id&&u.pos===p))return null;
      route.push(p);
    }
    return {destination,path:route};
  }
  function inRange(a,side,pos,kind,s) {
    if(kind==='return')return hasEffect(a,'returnHome')&&!(s?.skillCooldownVersion===1?returnSkillOption(a)?.used:a.returnUsed)&&pos!==a.pos&&boardOf(pos)===a.side&&(!s||freeCell(s,pos));
    if(kind==='skill'&&activeSkill(a)==='stamp')return stampCells(a,pos).length>0;
    if(kind==='skill'&&activeSkill(a)==='spearThrow')return side!==a.side&&range(a,{pos})===4;
    if(kind==='skill'&&activeSkill(a)==='grapple')return grappleCell(a,{side,pos,hp:1})!==null;
    if(kind==='skill'&&activeSkill(a)==='itemUse')return false;
    if(kind==='skill'&&activeSkill(a)==='legSweep')return sweepCells(a).includes(pos);
    if(kind==='skill'&&activeSkill(a)==='poleVault')return !!s&&vaultCell(s,a,pos);
    if(a.job==='porter')return kind==='skill'&&side===a.side&&pos===a.pos;
    if(kind==='skill'&&activeSkill(a)==='scout')return !!(s&&ambush(s,a,{side,pos,hp:1}));
    const support=kind==='skill'&&['guard','mage','healingCross','defenseLine','manaGift'].includes(activeSkill(a));
    return (support?side===a.side:side!==a.side)&&range(a,{pos})<=attackReach(a,kind)&&(support||kind!=='skill'||reachFilteredPower(a,{pos},kind).base>0);
  }
  function legalFor(s,a,kind,target) {
    if(s.deploying||s.result||!a||a.hp<=0||a.pendingStamp)return false;
    if(kind==='skill'&&!activeSkill(a))return false;
    if(s.skillCooldownVersion===1&&kind==='skill'&&actionSkillOption(a,kind)?.cooldown>0)return false;
    if(kind==='guard')return true;
    if(kind==='move')return target!==a.pos&&(paths(s,a,moveReach(a)).has(target)||!!swapTarget(s,a,target));
    if(kind==='return')return Number.isInteger(target)&&target>=0&&target<50&&inRange(a,a.side,target,kind,s);
    if(kind==='skill'&&equipmentSkills[activeSkill(a)]){
      const id=activeSkill(a),d=equipmentSkills[id];if(a.mp<d.cost||id==='itemUse')return false;
      if(id==='legSweep')return target===a.id;
      if(id==='spearThrow'){const option=selectedSkillOption(a),b=alive(s).find(u=>u.id===target);return !!b&&b.side!==a.side&&range(a,b)===4&&['rightHand','leftHand'].includes(option?.slot)&&a.equipment?.[option.slot]===option.itemId&&option.itemId==='javelin-wood';}
      if(id==='poleVault')return vaultCell(s,a,target);
      if(d.target==='pair'||d.target==='upToTwo'){
        return Array.isArray(target)&&target.length>0&&target.length<=2&&(d.target!=='pair'||target.length===2)&&new Set(target).size===target.length&&target.every(t=>{const b=alive(s).find(u=>u.id===t);return b&&b.id!==a.id&&inRange(a,b.side,b.pos,kind,s);});
      }
      const b=alive(s).find(u=>u.id===target);if(!b||!inRange(a,b.side,b.pos,kind,s))return false;
      if(id==='retreatSlash')return retreatCell(s,a)!==null;
      if(id==='healingCross')return alive(s).some(u=>u.side===a.side&&crossCells(b.pos).includes(u.pos)&&u.hp<u.max);
      if(id==='manaGift')return b.id!==a.id&&a.mp>0&&b.mp<b.maxMp;
      return true;
    }
    if(kind==='skill'&&activeSkill(a)==='stamp')return a.mp>0&&stampCells(a,target).length>0;
    const b=alive(s).find(u=>u.id===target);if(!b)return false;
    if(kind==='ether')return a.side==='ally'&&a.job==='porter'&&itemCount(s,a,'ether')>0&&itemInRange(a,b)&&b.mp<b.maxMp;
    if(kind==='item')return itemCount(s,a,'potion')>0&&itemInRange(a,b)&&b.hp<b.max;
    if(kind==='attack')return a.job!=='porter'&&b.side!==a.side&&range(a,b)<=attackReach(a,'attack');
    if(kind!=='skill'||a.mp<skillCost(a))return false;
    if(a.job==='porter')return b.id===a.id&&formation(s,a.side);
    if(activeSkill(a)==='scout')return !!ambush(s,a,b);
    if(!inRange(a,b.side,b.pos,kind,s))return false;
    return activeSkill(a)==='mage'?b.hp<b.max:activeSkill(a)==='guard'?b.id!==a.id:true;
  }
  const legal=(s,k,t)=>legalFor(s,s.units.find(u=>u.id===s.actor),k,t);
  function damageResult(s,target,power,formed=formation(s,target.side)) {
    const protector=alive(s).find(u=>u.side===target.side&&(u.cover===target.id||u.covers?.includes(target.id)));
    const recipient=protector||target,formationFactor=formed?(boosted(s,target.side)?.65:.75):1,guardFactor=recipient.guard?.5:1;
    const raw=typeof power==='number'?power-(recipient.def??0):Object.entries(power).reduce((n,[kind,value])=>{
      const defense={physical:recipient.def??0,fire:recipient.defFire??0,water:recipient.defWater??0,earth:recipient.defEarth??0}[kind]||0;
      const element=recipient.element,advantage={water:'fire',fire:'earth',earth:'water'}[kind],disadvantage={fire:'water',earth:'fire',water:'earth'}[kind];
      const factor=!element||element==='none'||kind==='physical'?1:advantage===element?1.25:disadvantage===element?0.75:1;
      return n+Math.max(0,value-defense)*factor;
    },0);
    const hit=Math.max(0,Math.round(raw*formationFactor*guardFactor));
    return {protector,recipient,hit};
  }
  function refreshEncumbrance(s) {
    if(!Number.isFinite(s.partyAliveInitial)||!Number.isFinite(s.initialDownWeight))return;
    const allies=s.units.filter(u=>u.side==='ally'),newlyDown=allies.filter(u=>u.startedAlive&&u.hp<=0);
    const survivors=s.partyAliveInitial-newlyDown.length;
    const fallen=s.initialDownWeight+newlyDown.reduce((n,u)=>n+(u.carriedWeight||0),0);
    const share=survivors>0?fallen/survivors:0;
    for(const u of allies){
      u.fallenWeightShare=u.hp>0?share:0;
      const over=u.hp>0&&survivors>0&&(u.carriedWeight+share>u.weightLimit);
      u.overburdened=over;u.agi=u.baseAgi*(over?0.5:1);
    }
  }
  function attackPreview(s,a,target) {
    if(!legalFor(s,a,'attack',target.id))return null;
    const contribution=reachFilteredPower(a,target),{recipient,hit}=damageResult(s,target,power(s,a,contribution.components,false));
    return {targetId:target.id,targetName:target.name,recipientId:recipient.id,recipientName:recipient.name,damage:hit,hpLoss:Math.min(recipient.hp,hit),evasionChance:evasionChance(recipient),...contribution};
  }
  function receive(s,target,power,formed=formation(s,target.side),contribution=null) {
    const {protector,recipient,hit}=damageResult(s,target,power,formed);
    if(s.damagePreviewEvents)s.damagePreviewEvents.push({targetId:target.id,targetName:target.name,recipientId:recipient.id,recipientName:recipient.name,damage:hit,hpLoss:Math.min(recipient.hp,hit),...(contribution||{base:power,weapons:[],bonus:0})});
    recipient.hp=Math.max(0,recipient.hp-hit);
    if(recipient.hp===0)refreshEncumbrance(s);
    if(recipient.hp===0&&recipient.covers)recipient.covers=[];
    log(s,`${protector?`${recipient.name}が${target.name}をかばう：`:""}${recipient.name}に${hit}ダメージ${recipient.hp===0?"・戦闘不能":""}`);
  }
  function apply(s,a,kind,target,landing,fixedCells,random=Math.random,resolvingCast=false) {
    if(kind==='skill'&&activeSkill(a)==='stamp'&&!resolvingCast){
      const option=selectedSkillOption(a);
      a.pendingStamp={key:option.key,center:target,origin:a.pos,cells:[...(fixedCells||stampCells(a,target))]};
      Presentation.mark(s,a,'cast',target,{activeSkill,skillName});a.mp-=skillCost(a);log(s,`${a.name}はスタンプを構えた。次の本人の行動で指定マスへ発動する。`);return;
    }
    Presentation.mark(s,a,kind,target,{activeSkill,skillName,...(resolvingCast?{resolvedCells:fixedCells}:{})});
    startSkillCooldown(s,a,kind);
    if(kind==='return'){a.pos=target;if(s.skillCooldownVersion===1){const option=returnSkillOption(a);(a.returnUsedGrants||(a.returnUsedGrants={}))[option.key]=true;}else a.returnUsed=true;emit(s,a,'returnHome',{target});log(s,`${a.name}の帰還 → (${x(target)+1},${y(target)+1})`);return;}
    if(kind==='skill'&&equipmentSkills[activeSkill(a)]){
      const id=activeSkill(a),b=s.units.find(u=>u.id===target),d=equipmentSkills[id];
      a.mp-=d.cost;emit(s,a,id,{target});log(s,`${a.name}の${d.name}`);
      if(id==='spearThrow'){
        const option=selectedSkillOption(a),weapon=a.attackWeapons.find(w=>w.slot===option.slot&&w.itemId===option.itemId);
        const components={physical:weapon.atk+(a.attackBonus||0),fire:weapon.atkFire||0,water:weapon.atkWater||0,earth:weapon.atkEarth||0};
        const contribution={base:Object.values(components).reduce((n,v)=>n+v,0),weapons:[weapon],bonus:a.attackBonus||0,components};
        receive(s,b,power(s,a,components),undefined,contribution);
        (a.thrownWeapons||(a.thrownWeapons={}))[option.slot]=option.itemId;
        a.equipment[option.slot]='empty-'+option.slot;
        a.attackWeapons=a.attackWeapons.filter(w=>w.slot!==option.slot);
        a.skillSources=a.skillSources.flatMap(source=>source.slot===option.slot?(source.grantSlot===1?[{id:'itemUse',slot:option.slot,itemId:'empty-'+option.slot,grantSlot:1,classification:'passive',level:a.job==='porter'?3:1}]:[]):[source]);
        a.activeSkills=[...new Set(a.skillSources.filter(source=>source.classification==='active'&&source.id!=='returnHome').map(source=>source.id))];
        a.effects=[...new Set(a.skillSources.filter(source=>source.classification==='passive'||source.id==='returnHome').map(source=>source.id))];
        a.equippedSkill=a.activeSkills[0]||null;delete a.selectedSkill;delete a.selectedSkillKey;
        const first=a.attackWeapons[0];a.weapon=first?require('./master-data.cjs').getMaster().gear.find(g=>g.id===first.itemId)?.type:'empty';a.atk=first?first.atk+(a.attackBonus||0):(a.attackBonus||0);a.reach=first?.reach||1;
        if(a.skillCooldowns)delete a.skillCooldowns[option.key];
        log(s,'投げた手は拳になった。槍は戦闘後に回収する。');return;
      }
      if(id==='legSweep'){
        for(const u of sweepTargets(s,a)){
          const success=random()<sweepChance(a);
          if(success)u.skipNextTurn=true; // Repeated successes never add skipped turns.
          log(s,`${u.name}：足払い${success?'成功（次の1手番をスキップ）':'失敗'}`);
        }
        return;
      }
      if(id==='poleVault'){a.pos=target;log(s,`${a.name}が${x(target)+1},${y(target)+1}へ跳躍。`);return;}
      if(id==='grapple'){const p=grappleCell(a,b);if(freeCell(s,p)){b.pos=p;log(s,`${b.name}を1マス引き寄せた。`);}else log(s,'引き寄せ先が占有されているため移動なし。');return;}
      if(id==='manaGift'){const amount=Math.min(2,a.mp,b.maxMp-b.mp);a.mp-=amount;b.mp+=amount;log(s,`${a.name}から${b.name}へMP${amount}移譲。`);return;}
      if(id==='defenseLine'){a.covers=[...target];a.cover=null;log(s,`次の本人の番まで ${target.map(id=>s.units.find(u=>u.id===id).name).join('・')} をかばう。`);return;}
      if(id==='healingCross'){for(const u of alive(s).filter(u=>u.side===a.side&&crossCells(b.pos).includes(u.pos))){const n=Math.min(30,u.max-u.hp);u.hp+=n;log(s,`${u.name}のHP＋${n}`);}return;}
      const factor=power(s,a,1);
      if(id==='splitShot'){for(const id of target){const u=s.units.find(u=>u.id===id),contribution=reachFilteredPower(a,u,'skill');if(u.hp>0&&contribution.base>0)receive(s,u,Object.fromEntries(Object.entries(contribution.components).map(([k,v])=>[k,v*factor*.6])),undefined,contribution);}return;}
      const destination=id==='retreatSlash'?retreatCell(s,a):null;
      const multiplier=id==='retreatSlash'?.7:id==='pincer'&&alive(s).some(u=>u.side===a.side&&u.id!==a.id&&range(u,b)===1)?1.5:1;
      const contribution=reachFilteredPower(a,b,'skill');
      if(contribution.base>0)receive(s,b,Object.fromEntries(Object.entries(contribution.components).map(([k,v])=>[k,v*factor*multiplier])),undefined,contribution);
      if(id==='retreatSlash'){a.pos=destination;log(s,`${a.name}が後退。`);}
      if(id==='knockback'&&b.hp>0){const p=b.pos+(x(b.pos)-x(a.pos))+10*(y(b.pos)-y(a.pos));if(freeCell(s,p)&&range(b,{pos:p})===1){b.pos=p;log(s,`${b.name}を1マス押し出した。`);}else log(s,'押し出し先なし：攻撃のみ。');}
      return;
    }
    if(kind==='move'){const b=swapTarget(s,a,target);if(hasEffect(a,'firstStride')&&!a.firstMoveUsed){a.firstMoveUsed=true;emit(s,a,'firstStride',{target});log(s,`${a.name}の先駆け：最初の移動。`);}if(b){b.pos=a.pos;a.pos=target;log(s,`${a.name}と${b.name}が入れ替わった。`);}else{a.pos=target;log(s,`${a.name}が${boardOf(target)==='ally'?'味方陣':'敵陣'}へ移動。`);}return;}
    if(kind==='guard'){a.guard=true;log(s,`${a.name}は防御。`);return;}
    const b=s.units.find(u=>u.id===target);
    if(kind==='ether'){consumeItem(s,a,'ether');const heal=Math.min(3,b.maxMp-b.mp);b.mp+=heal;log(s,`${a.name}のエーテル：${b.name}のMP＋${heal}`);return;}
    if(kind==='item'){consumeItem(s,a,'potion');const heal=Math.min(55,b.max-b.hp);b.hp+=heal;log(s,`${a.name}の回復薬：${b.name}のHP＋${heal}`);return;}
    if(kind==='skill'&&!resolvingCast)a.mp-=skillCost(a);
    if(kind==='skill'&&activeSkill(a)==='stamp'){
      const cells=fixedCells||stampCells(a,target),targets=alive(s).filter(u=>u.side!==a.side&&cells.includes(u.pos));
      // 各対象へ通常威力。陣形・かばう・防御は既存のダメージ処理を使う。
      const factor=power(s,a,1);
      log(s,`${a.name}のスタンプ → 中心(${x(target)+1},${y(target)+1})・${cells.length}マス${targets.length?'':'：空振り。'}`);
      for(const enemy of targets){const contribution=reachFilteredPower(a,enemy,'skill');if(enemy.hp>0&&contribution.base>0)receive(s,enemy,Object.fromEntries(Object.entries(contribution.components).map(([k,v])=>[k,v*factor])),undefined,contribution);}
      return;
    }
    if(kind==='skill'&&a.job==='porter'){a.boost=true;log(s,`${a.name}の陣形強化：次の本人の番まで攻撃＋75％・被害−35％。重複なし。`);return;}
    if(kind==='skill'&&activeSkill(a)==='mage'){const heal=Math.min(60,b.max-b.hp);b.hp+=heal;log(s,`${a.name}のヒール：${b.name}のHP＋${heal}`);return;}
    if(kind==='skill'&&activeSkill(a)==='guard'){a.cover=b.id;log(s,`${a.name}は次の自分の番まで${b.name}をかばう。`);return;}
    if(kind==='skill'&&activeSkill(a)==='scout')a.pos=landing;
    log(s,`${a.name}の${kind==='skill'?skillName(a):'攻撃'} → ${b.name}`);
    const contribution=reachFilteredPower(a,b,kind);
    if(kind==='attack'){const recipient=damageResult(s,b,0).recipient,chance=evasionChance(recipient);if(chance>0&&random()<chance){emit(s,recipient,'evasion',{sourceId:a.id});log(s,`${recipient.name}は攻撃を回避した。`);return;}}
    if(contribution.base>0)receive(s,b,power(s,a,contribution.components),undefined,contribution);
  }
  // Run the exact action on a detached copy; no turn advance or live events.
  function effectPreview(s,a,kind,target) {
    if(!legalFor(s,a,kind,target))return [];
    if(kind==='skill'&&activeSkill(a)==='stamp')return [{id:a.id,cast:true,cells:stampCells(a,target),mp:-1}];
    if(kind==='skill'&&activeSkill(a)==='legSweep')return [{id:a.id,mp:-1},...sweepTargets(s,a).map(u=>({id:u.id,skipChance:sweepChance(a),alreadySkipping:!!u.skipNextTurn}))];
    const copy=JSON.parse(JSON.stringify(s)),actor=copy.units.find(u=>u.id===a.id);
    const landing=kind==='skill'&&activeSkill(actor)==='scout'?ambush(copy,actor,copy.units.find(u=>u.id===target))?.destination:undefined;
    apply(copy,actor,kind,target,landing,undefined,()=>1);
    return copy.units.map(u=>{const old=s.units.find(v=>v.id===u.id);return {id:u.id,position:u.pos!==old.pos?u.pos:null,hp:u.hp-old.hp,mp:u.mp-old.mp,guard:u.guard&&!old.guard,boost:u.boost&&!old.boost,cover:u.cover!==old.cover?u.cover:null,covers:JSON.stringify(u.covers)!==JSON.stringify(old.covers)?u.covers:[]};}).filter(e=>e.position!==null||e.hp||e.mp||e.guard||e.boost||e.cover||e.covers?.length);
  }
  function damagePreview(s,a,kind,target) {
    if(!['attack','skill'].includes(kind)||!legalFor(s,a,kind,target)||kind==='skill'&&activeSkill(a)==='legSweep')return [];
    const copy=JSON.parse(JSON.stringify(s)),actor=copy.units.find(u=>u.id===a.id);
    copy.damagePreviewEvents=[];
    const landing=kind==='skill'&&activeSkill(actor)==='scout'?ambush(copy,actor,copy.units.find(u=>u.id===target))?.destination:undefined;
    apply(copy,actor,kind,target,landing,undefined,()=>1);
    return copy.damagePreviewEvents.map(hit=>({...hit,...(kind==='attack'?{evasionChance:evasionChance(copy.units.find(u=>u.id===hit.recipientId))}:{})}));
  }
  function plan(s,a) {
    const friends=alive(s).filter(u=>u.side===a.side), enemies=alive(s).filter(u=>u.side!==a.side).sort((l,r)=>l.hp-r.hp);
    const make=(kind,target,reason)=>{
      const b=s.units.find(u=>u.id===target), jump=kind==='skill'&&activeSkill(a)==='scout'?ambush(s,a,b):null;
      a.intent={kind,target,reason,name:kind==='skill'?skillName(a):({attack:'攻撃',move:'移動',guard:'防御',item:'回復薬'})[kind],cells:kind==='skill'&&activeSkill(a)==='stamp'?stampCells(a,target):kind==='attack'||(kind==='skill'&&['archer','scout'].includes(activeSkill(a)))?[b.pos]:[],destination:kind==='move'?target:jump?.destination,path:jump?.path};
    };
    const hurt=[...friends].sort((l,r)=>(r.max-r.hp)-(l.max-l.hp));
    if(activeSkill(a)==='mage'){const b=hurt.find(b=>b.max-b.hp>=30&&legalFor(s,a,'skill',b.id));if(b){make('skill',b.id,'傷ついた味方を回復');return;}}
    if(activeSkill(a)==='guard'){const b=hurt.find(b=>b.id!==a.id&&b.hp<b.max*.65&&legalFor(s,a,'skill',b.id));if(b){make('skill',b.id,'傷ついた隣の味方を守る');return;}}
    const endangered=hurt.find(b=>b.hp<b.max*.3&&legalFor(s,a,'item',b.id));
    if(endangered){make('item',endangered.id,'瀕死の味方を救援');return;}
    if(activeSkill(a)==='stamp'){
      const centers=Array.from({length:50},(_,p)=>p).filter(p=>legalFor(s,a,'skill',p));
      const count=p=>enemies.filter(b=>stampCells(a,p).includes(b.pos)).length;
      centers.sort((l,r)=>count(r)-count(l));
      if(centers.length&&count(centers[0])){make('skill',centers[0],'指定した3マスの敵を狙う');return;}
    }
    const skill=enemies.find(b=>legalFor(s,a,'skill',b.id));
    if(skill){make('skill',skill.id,activeSkill(a)==='scout'?'装備の奇襲Lvの範囲内にいる弱った敵へ奇襲':'射程内の弱った敵を狙う');return;}
    const attack=enemies.find(b=>legalFor(s,a,'attack',b.id));
    if(attack){make('attack',attack.id,'射程内の弱った敵を狙う');return;}
    const goal=activeSkill(a)==='mage'&&hurt[0]?.hp<hurt[0]?.max*.7?hurt[0]:enemies[0];
    if(goal){const options=[...paths(s,a,2).keys()].filter(p=>p!==a.pos).sort((l,r)=>range({pos:l},goal)-range({pos:r},goal));if(options.length&&range({pos:options[0]},goal)<range(a,goal)){make('move',options[0],'届く位置へ接近');return;}}
    make('guard',null,'次の機会に備える');
  }
  function enemyAction(s,a) {
    Presentation.mark(s,a,a.intent.kind==='skill'&&activeSkill(a)==='stamp'?'cast':a.intent.kind,a.intent.target,{activeSkill,skillName});
    const i=a.intent;s.recentEnemies.push({name:a.name,action:i.name});
    if(s.skillCooldownVersion===1&&actionSkillOption(a,i.kind)?.cooldown>0){log(s,`${a.name}の${i.name}は再使用待ち。`);return;}
    // 攻撃の予告は人物追尾せずセル固定。奇襲の着地点も固定。
    if(i.cells.length){
      if(i.kind==='skill'&&activeSkill(a)==='stamp'){
        if(a.mp<=0){log(s,`${a.name}のスタンプはMP不足で見送り。`);return;}
        apply(s,a,i.kind,i.target,undefined,i.cells);return;
      }
      if(i.kind==='skill'&&activeSkill(a)==='scout') {
        const reserved=ambush(s,a,{side:a.side==='ally'?'enemy':'ally',pos:i.cells[0],hp:1});
        if(a.mp<=0||!reserved||reserved.destination!==i.destination||i.path.some(p=>alive(s).some(u=>u.id!==a.id&&u.pos===p))){log(s,`${a.name}の奇襲経路が塞がれた。`);return;}
        a.pos=i.destination;
      }
      const b=alive(s).find(u=>u.side!==a.side&&u.pos===i.cells[0]);
      if(!b||range(a,b)>attackReach(a,i.kind)){if(i.kind==='skill'&&activeSkill(a)==='scout'){a.mp-=skillCost(a);startSkillCooldown(s,a,i.kind);}log(s,`${a.name}の${i.name}は空振り。`);return;}
      if(i.kind==='skill'&&a.mp<=0){log(s,`${a.name}の${i.name}はMP不足で見送り。`);return;}
      apply(s,a,i.kind,b.id,i.destination);return;
    }
    if(legalFor(s,a,i.kind,i.target))apply(s,a,i.kind,i.target);
    else log(s,`${a.name}の${i.name}は対象・経路が無効になり見送り。`);
  }
  const order=(a,b)=>a.next-b.next||b.agi-a.agi||a.tie-b.tie;
  function check(s){const fallen=s.units.find(u=>u.side==='ally'&&u.job==='porter'&&u.hp<=0);if(fallen){s.failure='porter';s.result=`クエスト失敗。${fallen.name}が倒れ、荷物を運べなくなった。`;}else if(!alive(s).some(u=>u.side==='enemy'))s.result='勝利！ ミラーマッチを制した。';else if(!alive(s).some(u=>u.side==='ally'))s.result='敗北。配置と連携を変えて再挑戦しよう。';
    if(s.result){
      for(const u of s.units){if(u.covers)u.covers=[];delete u.skillCooldowns;delete u.pendingStamp;}
      if(!s.failure&&!alive(s).some(u=>u.side==='enemy')&&!s.victoryEffectsApplied&&s.units.some(u=>hasEffect(u,'victoryBreath'))){
        s.victoryEffectsApplied=true;
        for(const u of alive(s).filter(u=>u.side==='ally'&&hasEffect(u,'victoryBreath'))){const amount=Math.min(2,u.maxMp-u.mp);u.mp+=amount;emit(s,u,'victoryBreath',{amount});log(s,`${u.name}の一息：MP＋${amount}`);}
      }
    }
    return !!s.result;}
  function advance(s){
    while(!check(s)){
      const a=alive(s).sort(order)[0];a.guard=false;a.cover=null;if(a.covers)a.covers=[];a.boost=false;s.actor=a.id;
      if(a.skipNextTurn){
        if(a.pendingStamp){delete a.pendingStamp;log(s,`${a.name}のスタンプの構えは足払いで中断された。`);}
        Presentation.mark(s,a,'skip',null,{activeSkill,skillName});
        delete a.skipNextTurn;finishOpportunity(a);a.next+=100/a.agi;
        log(s,`${a.name}：足払いで手番をスキップ。`);
        if(a.side==='enemy')plan(s,a);
        continue;
      }
      if(a.pendingStamp){
        const reserved=a.pendingStamp;delete a.pendingStamp;
        const option=activeSkillOptions(a).find(option=>option.key===reserved.key&&option.id==='stamp');
        if(option){a.selectedSkill=option.id;a.selectedSkillKey=option.key;apply(s,a,'skill',reserved.center,undefined,reserved.cells,Math.random,true);}
        else log(s,`${a.name}のスタンプは使用条件を満たさないため中止。`);
        finishOpportunity(a);a.next+=100/a.agi;s.actions++;if(a.side==='enemy')plan(s,a);continue;
      }
      if(a.side==='ally'||Presentation.isStepping(s))return;
      enemyAction(s,a);finishOpportunity(a);a.next+=100/a.agi;if(check(s))break;plan(s,a);
    }
    s.actor=null;
  }
  function stepEnemy(s){const a=s.units.find(u=>u.id===s.actor);if(!a||a.side!=='enemy'||s.result)return false;enemyAction(s,a);finishOpportunity(a);a.next+=100/a.agi;if(!check(s))plan(s,a);advance(s);return true;}
  function create(options={}){
    const units=[];
    for(const side of ['ally','enemy']){
      const ids=options[side]||defaultJobs,used=new Set();
      const members=ids.map(id=>({...roster.find(t=>t.id===id)}));
      for(const t of members){if(!used.has(t.pos)){used.add(t.pos);}else t.pos=null;}
      for(const t of members){if(t.pos===null){t.pos=(t.job==='porter'?[32,12,2,42]:[24,13,33,4,14,34]).find(p=>!used.has(p));used.add(t.pos);}}
      if(side==='ally'&&options.formation==='flank'){const scout=members.find(t=>t.job==='scout');if(scout)scout.pos=14;}
      members.forEach((t,index)=>{
        const roleIndex=templates.findIndex(p=>p.job===t.job),old=side==='ally'?options.previous?.find(p=>p.id===t.id):null;
        const maxMp=old?.maxMp??t.mp+(side==='ally'?(options.bonusMp||0):0);
        units.push({...t,id:side==='ally'?t.id:'enemy-'+t.id,side,name:side==='ally'?t.name:'敵'+t.role+(options.enemy?' '+(index+1):''),pos:side==='ally'?t.pos:y(t.pos)*10+9-x(t.pos),hp:old?.hp??t.max,mp:old?.mp??maxMp,maxMp,def:0,...(options.skillStage!==undefined?{skillStage:options.skillStage}:{}),next:100/t.agi,guard:false,cover:null,tie:roleIndex*4+(side===(roleIndex%2?'ally':'enemy')?0:1)+index*.01});
      });
    }
    const s={...(options.formationVersion?{formationVersion:options.formationVersion,formationKind:options.formation||'convoy'}:{}),units,actor:null,result:null,potions:{ally:options.potions??3,enemy:options.enemyPotions??3},log:[options.ally?'荷物を守り、街道を切り抜けよう。':'4対4ミラーマッチ。スカウトだけが敵陣へ踏み込める。'],actions:0,recentEnemies:[]};if(options.ethers!==undefined)s.ethers=options.ethers;if(options.deployment){s.deploying=true;return s;}units.filter(u=>u.side==='enemy').forEach(u=>plan(s,u));advance(s);return s;
  }
  function deploy(s,id,pos){
    const a=alive(s).find(u=>u.id===id&&u.side==='ally');
    if(!s.deploying||!a||!Number.isInteger(pos)||pos<0||pos>=50||boardOf(pos)!=='ally')return false;
    const b=alive(s).find(u=>u.pos===pos&&u.id!==id);
    if(b&&b.side!=='ally')return false;
    if(b)b.pos=a.pos;a.pos=pos;return true;
  }
  function begin(s){
    if(!s.deploying)return false;
    const units=alive(s);
    if(new Set(units.map(u=>u.pos)).size!==units.length||units.some(u=>!Number.isInteger(u.pos)||u.pos<0||u.pos>=50||boardOf(u.pos)!==u.side))return false;
    s.deploying=false;units.filter(u=>u.side==='enemy').forEach(u=>plan(s,u));advance(s);return true;
  }
  function act(s,kind,target,random=Math.random){if(!legal(s,kind,target))return false;const a=s.units.find(u=>u.id===s.actor);s.recentEnemies=[];const jump=kind==='skill'&&activeSkill(a)==='scout'?ambush(s,a,s.units.find(u=>u.id===target)):null;apply(s,a,kind,target,jump?.destination,undefined,random);finishOpportunity(a);a.next+=100/a.agi;s.actions++;advance(s);return true;}
  function queue(s){const copies=alive(s).map(u=>({...u})),result=[];for(let i=0;i<10&&copies.length;i++){copies.sort(order);result.push({id:copies[0].id,name:copies[0].name,side:copies[0].side,...(copies[0].skipNextTurn?{skip:true}:{})});delete copies[0].skipNextTurn;copies[0].next+=100/copies[0].agi;}return result;}
  return {returnSkillOptions,returnSkillOption,selectReturnSkill,activeSkillOptions,selectedSkillOption,itemSkillOption,sweepCells,sweepChance,sweepTargets,vaultCell,itemUseLevel,itemInRange,grappleCell,skillLevel,skillInfo,effectCount,percentageIncrease,stepEnemy,damagePreview,effectPreview,reachFilteredPower,attackPreview,activeSkills,selectSkill,equipmentSkills,hasEffect,moveReach,skillCost,skillTargets,crossCells,retreatCell,MAX_LOG_LINES,trimLog,legacyRoster,recruitRoster,roster,create,deploy,begin,act,legal,legalFor,formation,boosted,swapTarget,slots,formationSlots,queue,range,screen,cell,boardOf,activeSkill,skillName,attackReach,stampCells,inRange,paths,ambush,receive,plan};
})();
if(typeof module!=='undefined')module.exports=Battle;
