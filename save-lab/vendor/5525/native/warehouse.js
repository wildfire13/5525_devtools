'use strict';
// A warehouse transfer is one validated inventory transaction, never a save
// rewrite. Equipped items and quest cargo are not warehouse entries.
module.exports=function({I,getGear,items,template,inventoryToken,commitInventory,inventoryCapacity,note}){
  const definition=id=>getGear(id)||items.find(item=>item.id===id);
  const available=s=>s.phase==='town'&&s.location==='astaris';
  function quote(s,ownerId,id,direction,amount=1){
    const owner=s.characters[ownerId],d=definition(id);
    const source=direction==='deposit'?owner?.inventory:s.warehouse||{};
    const target=direction==='deposit'?s.warehouse||{}:owner?.inventory;
    const q={ok:false,reason:'',ownerId,itemId:id,direction,count:amount,name:d?.name||id,available:I.count(source,id),token:inventoryToken(s)};
    const fail=reason=>({...q,reason});
    if(!available(s))return fail('倉庫はアスタリスのギルドで利用できます');
    if(!owner||!s.selected.includes(ownerId))return fail('パーティーから持ち主を選んでください');
    if(!['deposit','withdraw'].includes(direction))return fail('預けるか取り出すかを選んでください');
    if(!d||d.type==='empty'||d.virtualDefault)return fail('倉庫で扱えない品物です');
    if(d.transferable===false)return fail('受け渡しできない装備は倉庫にも預けられません');
    if(!I.quantity(amount)||q.available<amount)return fail('個数を確認してください');
    if(!I.transfer(source,target,id,amount))return fail('保存できる個数を超えています');
    if(direction==='withdraw'&&!I.canReceive(target,id,amount,inventoryCapacity(s,ownerId)))return fail('インベントリの枠が不足しています');
    return {...q,ok:true};
  }
  function action(s,ownerId,id,direction,amount,token){
    if(token!==inventoryToken(s))return false;
    const q=quote(s,ownerId,id,direction,amount);if(!q.ok)return false;
    return commitInventory(s,draft=>{
      const owner=draft.characters[ownerId];draft.warehouse??={};
      const moved=I.transfer(direction==='deposit'?owner.inventory:draft.warehouse,direction==='deposit'?draft.warehouse:owner.inventory,id,amount);
      if(!moved)return false;
      if(direction==='deposit'){owner.inventory=moved.source;draft.warehouse=moved.target;}
      else{draft.warehouse=moved.source;owner.inventory=moved.target;}
      note(draft,`${template(ownerId).name}：${q.name} ${amount}個を${direction==='deposit'?'倉庫に預けた':'倉庫から取り出した'}。`);
      return true;
    });
  }
  function view(s){
    return {available:available(s),token:inventoryToken(s),entries:Object.entries(s.warehouse||{}).map(([id,count])=>({id,count,name:definition(id)?.name||id})),
      owners:Object.fromEntries(s.selected.map(ownerId=>[ownerId,{limit:inventoryCapacity(s,ownerId),
        deposits:Object.keys(s.characters[ownerId].inventory).map(id=>quote(s,ownerId,id,'deposit')),
        withdrawals:Object.keys(s.warehouse||{}).map(id=>quote(s,ownerId,id,'withdraw'))}]))};
  }
  return {warehouseQuote:quote,warehouseAction:action,warehouseView:view};
};
