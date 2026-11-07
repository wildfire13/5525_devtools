'use strict';
// Quotes are pure. Every multi-owner mutation validates a complete detached state.
module.exports=function({I,S,clone,record,integer,getGear,template,shop,equipment,eligibility,stats,syncCharacter,validate,inventoryToken,inventoryCapacity,commitInventory,note,createHash}) {
  function saleAvailable(s){return s.phase==='town'&&['east','west','north'].includes(s.location);}
  // Consent covers this exact single-item payment, before a recipient is chosen.
  function purchaseQuote(s,id,ownerId=null) {
    const g=getGear(id),q={ok:false,reason:'',gearId:id,count:1,gear:g?clone(g):null,cost:g?.price||0,goldBefore:s.gold,afterGold:s.gold-(g?.price||0),token:''};
    if(!saleAvailable(s)||!g||g.type==='empty'||!shop(s).some(item=>item.id===id))return {...q,reason:'この店で購入できる商品を選んでください'};
    q.token=createHash('sha256').update(JSON.stringify([inventoryToken(s),id,g.price])).digest('hex');
    if(s.gold<q.cost)return {...q,reason:'所持金が不足しています'};
    if(!s.selected.some(owner=>I.canReceive(s.characters[owner].inventory,id,1,inventoryCapacity(s,owner))))return {...q,reason:'受取可能なインベントリがありません'};
    if(ownerId!==null&&(!s.selected.includes(ownerId)||!s.characters[ownerId]||!I.canReceive(s.characters[ownerId].inventory,id,1,inventoryCapacity(s,ownerId))))return {...q,reason:'選択した人物のインベントリに空きがありません'};
    return {...q,ok:true};
  }
  function buyInventory(s,ownerId,id,token) {
    const q=purchaseQuote(s,id);
    if(!q.ok||token!==q.token||!template(ownerId)||!s.selected.includes(ownerId))return false;
    if(!I.canReceive(s.characters[ownerId].inventory,id,1,inventoryCapacity(s,ownerId)))return false;
    return commitInventory(s,draft=>{
      const owner=draft.characters[ownerId],bag=I.add(owner.inventory,id,1);if(!bag)return false;
      owner.inventory=bag;draft.gold=q.afterGold;
      note(draft,`${template(ownerId).name}が${q.gear.name}を1個、${q.cost}Gで購入。本人のインベントリへ。`);return true;
    });
  }
  function purchasePlan(s,entries) {
    const plan={ok:false,reason:'',rows:[],cost:0,goldBefore:s.gold,afterGold:s.gold,shortfall:0,token:''};
    if(s.phase!=='town'||!Array.isArray(entries)||entries.length<1||entries.length>s.selected.length*Object.keys(S.slots).length)return {...plan,reason:'この店で購入する装備を計画に追加してください'};
    const draft=clone(s),keys=new Set(),changed=new Set();
    for(const entry of entries){
      if(!record(entry)||typeof entry.characterId!=='string'||typeof entry.gearId!=='string'||!Object.hasOwn(S.slots,entry.slot))return {...plan,reason:'購入計画の形式が不正です'};
      const {characterId,gearId,slot}=entry,key=characterId+'/'+slot,c=s.characters[characterId],g=getGear(gearId);
      if(keys.has(key))return {...plan,reason:'同じ人物・装備枠の購入が重複しています'};
      keys.add(key);
      if(!template(characterId)||!c||!s.selected.includes(characterId)||!g||!S.allowed(g).includes(slot))return {...plan,reason:'購入先または装備枠を確認してください'};
      const old=getGear(equipment(c)[slot]),eligible=eligibility(s,characterId,gearId),available=shop(s).some(item=>item.id===gearId);
      if(old.removable===false&&old.id!==g.id){eligible.ok=false;eligible.reason='この装備は外せません';}
      const row={characterId,gearId,slot,characterName:template(characterId).name,gear:clone(g),current:clone(old),oldGearId:old.id,cost:g.price,retained:old.type!=='empty',ok:eligible.ok&&available&&old.id!==g.id,reason:!eligible.ok?eligible.reason:!available?'この店の取扱外':old.id===g.id?'すでに装備しています':''};
      const owner=draft.characters[characterId];
      if(row.retained){const bag=I.add(owner.inventory,old.id,1);if(!bag)return {...plan,reason:'所持品を保存できる範囲を超えます'};owner.inventory=bag;}
      owner[S.storage(slot)]=gearId;changed.add(characterId);plan.cost+=g.price;plan.rows.push(row);
    }
    for(const id of changed){
      const eq=equipment(draft.characters[id]),used=Object.values(eq).filter(id=>!id.startsWith('empty-')).map(S.identity);
      let reason='';
      if(getGear(eq.rightHand).hands===2&&eq.leftHand!=='empty-leftHand')reason='両手装備には左手を外す計画も必要です';
      if(new Set(used).size!==used.length)reason='同じ装備は二つの枠に装備できません';
      syncCharacter(draft,id);
      for(const row of plan.rows.filter(row=>row.characterId===id)){
        if(reason){row.ok=false;row.reason=reason;}
        row.before=stats(s.characters[id]);row.after=stats(draft.characters[id]);
        row.signature=createHash('sha256').update(JSON.stringify(row)).digest('hex');
      }
    }
    plan.afterGold=s.gold-plan.cost;plan.shortfall=Math.max(0,-plan.afterGold);
    plan.reason=plan.rows.find(row=>!row.ok)?.reason||(!validate(draft).ok?'現在の状態ではまとめて購入できません':plan.shortfall?`所持金が${plan.shortfall}G不足しています`:'');
    plan.ok=!plan.reason;
    plan.token=createHash('sha256').update(JSON.stringify([inventoryToken(s),entries,plan.rows.map(row=>row.signature)])).digest('hex');
    return plan;
  }
  function buyPlan(s,entries,token) {
    const plan=purchasePlan(s,entries);if(!plan.ok||token!==plan.token)return false;
    return commitInventory(s,draft=>{
      for(const row of plan.rows){
        const owner=draft.characters[row.characterId];
        if(row.retained){const bag=I.add(owner.inventory,row.oldGearId,1);if(!bag)return false;owner.inventory=bag;}
        owner[S.storage(row.slot)]=row.gearId;
      }
      draft.gold-=plan.cost;
      for(const id of new Set(plan.rows.map(row=>row.characterId)))syncCharacter(draft,id);
      note(draft,`${plan.rows.length}件をまとめて${plan.cost}Gで購入・装備。外した装備は各本人のインベントリへ。`);return true;
    });
  }
  function saleQuote(s,ownerId,id,count=1) {
    const g=getGear(id),owner=template(ownerId)&&s.characters[ownerId],amount=owner?I.count(owner.inventory,id):0;
    const price=g?.salePrice??g?.price??0;
    const q={ok:false,reason:'',ownerId,itemId:id,count,name:g?.name||id,ownerName:template(ownerId)?.name||ownerId,available:amount,price,proceeds:price*count,goldBefore:s.gold,afterGold:s.gold+price*count,token:inventoryToken(s)};
    if(!saleAvailable(s))return {...q,reason:'装備店（イース・ウエス・ノース）で売却できます'};
    if(!owner||!s.selected.includes(ownerId))return {...q,reason:'編成中の所持者を選んでください'};
    if(!g||g.type==='empty')return {...q,reason:'売却できる装備品を選んでください'};
    if(g.sellable===false)return {...q,reason:'この装備は売却できません'};
    if(!I.quantity(count)||count>amount)return {...q,reason:'所持数を確認してください。装備中の品は先に外してください'};
    if(!integer(q.afterGold))return {...q,reason:'所持金を保存できる範囲を超えます'};
    return {...q,ok:true};
  }
  function sellInventory(s,ownerId,id,count,token) {
    const q=saleQuote(s,ownerId,id,count);if(!q.ok||token!==q.token)return false;
    return commitInventory(s,draft=>{
      const bag=I.remove(draft.characters[ownerId].inventory,id,count);if(!bag)return false;
      draft.characters[ownerId].inventory=bag;draft.gold=q.afterGold;
      note(draft,`${q.ownerName}の${q.name} ${count}個を${q.proceeds}Gで売却。`);return true;
    });
  }
  return {purchaseQuote,buyInventory,purchasePlan,buyPlan,saleQuote,sellInventory,saleAvailable};
};
