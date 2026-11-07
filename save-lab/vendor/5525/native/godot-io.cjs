'use strict';
// Compatibility entry for direct Node clients. Godot uses a separately owned
// Python pipe, so file stalls cannot terminate the state-owning game process.
const {spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const invoke=r=>{
 const p=spawnSync(process.env.NATIVE5525_PYTHON||'python',['-X','utf8','-B',path.join(__dirname,'godot_files.py')],{input:JSON.stringify(r)+'\n',encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(p.error||p.status!==0)return {ok:false,transport_error:p.error?.code||'helper_exit'};
 try{return JSON.parse(p.stdout)}catch{return {ok:false,transport_error:'invalid_reply'}}
};
module.exports=r=>{
 const request={...r,...(r.action==='write'?{operation:randomBytes(16).toString('hex')}:{})};
 const result=invoke(request);
 if(!result.transport_error)return result;
 if(r.action==='write'){
  const recovered=invoke({...request,action:'recover_write'});
  if(recovered.ok)return recovered.data.outcome==='saved'?recovered:{ok:false,outcome:'not_saved',error:recovered.data.reason};
  return {ok:false,outcome:'unknown',error:'保存結果を確認できません。ゲーム進行は保持しています。保存先を確認してから別名で保存してください。'};
 }
 return {ok:false,error:'ファイル処理に失敗しました。Python + Pillowと保存先を確認してください。ゲーム進行は保持しています。'};
};
