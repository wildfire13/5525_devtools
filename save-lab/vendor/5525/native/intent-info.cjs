'use strict';
// Read-only interpretation of FIXED intents; never re-plan or move an enemy.
function describe(B,s,u){
 const i=u.intent,skill=B.activeSkill(u),info={id:u.id,normalReach:B.attackReach(u,'attack'),skillReach:skill==='scout'?null:B.attackReach(u,'skill'),skill:B.skillName(u),valid:false,reason:'配置確定後に予告'};
 if(!i||u.hp<=0)return info;
 let actor=u;
 if(i.kind==='skill'&&u.mp<=0)return {...info,reason:'MP不足・実行時は見送り'};
 if(i.kind==='skill'&&skill==='scout'){
  const jump=B.ambush(s,u,{side:u.side==='ally'?'enemy':'ally',pos:i.cells[0],hp:1});
  if(!jump||jump.destination!==i.destination)return {...info,reason:'現在の装備スキルLvでは予告方向・着地先が無効'};
  if(i.path.some(p=>s.units.some(t=>t.hp>0&&t.id!==u.id&&t.pos===p)))return {...info,reason:'奇襲経路が塞がっている'};
  actor={...u,pos:i.destination};
 }
 if(i.cells.length&&!(i.kind==='skill'&&skill==='stamp')){
  const target=s.units.find(t=>t.hp>0&&t.side!==u.side&&t.pos===i.cells[0]);
  if(!target)return {...info,reason:'予告マスに対象なし・現在は空振り予定'};
  if(B.range(actor,target)>B.attackReach(actor,i.kind))return {...info,reason:'現在は射程外・予告固定、実行時は空振り'};
  return {...info,valid:true,reason:'現在は命中可能（予告マス固定）'};
 }
 const valid=i.kind==='skill'&&skill==='stamp'?u.mp>0:B.legalFor(s,u,i.kind,i.target);
 return {...info,valid,reason:valid?'現在は実行可能':'現在は対象・経路が無効'};
}
module.exports={describe};
