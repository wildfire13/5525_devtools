'use strict';
// Read once at process startup. No fallback to stale hardcoded data or save writes.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
function loadMaster(dbPath=path.join(__dirname,'data','master.sqlite')) {
 const run=spawnSync(process.env.NATIVE5525_PYTHON||'python',['-X','utf8','-B',path.join(__dirname,'master_data.py'),'read','--db',dbPath],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(run.error||run.status!==0)throw new Error('マスタデータを読み込めません。配布ファイルとPython環境を確認してください。セーブは変更していません。');
 try{return JSON.parse(run.stdout)}catch{throw new Error('マスタデータの応答が不正です。セーブは変更していません。');}
}
let cached;
function getMaster(){if(!cached)cached=loadMaster();return cached;}
module.exports={loadMaster,getMaster};
