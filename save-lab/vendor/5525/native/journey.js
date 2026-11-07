"use strict";
const Journey=(()=>{
 const jobs=[
  {id:'medicine',name:'灯台村へ、夜明けの薬',client:'薬師イネス',cargo:'解熱薬の木箱',weight:3,deadline:7,reward:180,text:'熱を出した子どもたちに。夜明けの診療までに、峠の向こうの村へ届けてほしい。'},
  {id:'parts',name:'水車をもう一度',client:'粉挽きトマ',cargo:'水車の交換部品',weight:5,deadline:10,reward:150,text:'止まった水車を直せば、村で粉を挽ける。重い荷物だが、どうか頼む。'}
 ];
 const memberIds=['guard','guard-2','archer','archer-2','mage','mage-2','scout','scout-2','porter','porter-2','warrior'];
 const hasPorter=s=>s.selected.some(id=>id==='porter'||id==='porter-2');
 function create(){return {phase:'jobs',job:null,hours:0,gold:0,xp:0,level:1,stage:0,rested:false,kit:'medicine',formation:'convoy',selected:['guard','archer','mage','scout','porter'],party:null,potions:3,history:[],outcome:null};}
 function accept(s,id){if(s.phase!=='jobs'||!hasPorter(s))return false;const job=jobs.find(j=>j.id===id);if(!job)return false;s.job=job;s.phase='prepare';s.history.push(`${job.client}の依頼を受注。他の依頼は別の運び屋へ。`);return true;}
 function select(s,ids){if(s.phase!=='prepare'||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!memberIds.includes(id)))return false;s.selected=[...ids];return true;}
 function depart(s,kit,formation){if(s.phase!=='prepare'||!s.selected.length||!['medicine','ether'].includes(kit)||!['convoy','flank'].includes(formation))return false;s.kit=kit;s.formation=formation;s.potions=kit==='medicine'?3:1;s.phase='road';return true;}
 function randomEnemies(count,random=Math.random){const pool=memberIds.filter(id=>!id.startsWith('porter')&&id!=='warrior');for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}return pool.slice(0,count);}
 function forecast(s,choice){const remaining=2-s.stage;const hours=s.hours+(choice==='rest'?2:choice==='safe'?4:2)+(choice==='rest'?remaining*3:1+(remaining-1)*3);return {hours,late:hours>s.job.deadline,over:Math.max(0,hours-s.job.deadline)};}
 function travel(s,route){if(s.phase!=='road'||!['short','safe'].includes(route))return false;const cost=route==='short'?2:4;s.hours+=cost;s.route=route;s.phase='battle';s.history.push(`${s.stage+1}区間：${route==='short'?'峠の近道':'川沿いの迂回路'}（${cost}時間）。`);return true;}
 function finishBattle(s,b){if(s.phase!=='battle'||!b.result)return false;s.party=b.units.filter(u=>u.side==='ally').map(u=>({...u}));s.potions=b.potions.ally;s.hours+=1;s.history.push(`戦闘を終えた（1時間・味方${b.actions}行動）。`);const fallen=s.party.find(u=>u.job==='porter'&&u.hp<=0);if(fallen||s.party.every(u=>u.hp<=0)){s.phase='result';s.outcome='failed';s.failureReason=fallen?`${fallen.name}が戦闘不能になったため、クエスト失敗。`:'護送隊が全滅したため、クエスト失敗。';s.history.push(s.failureReason+'荷物は届けられなかった。');}else{s.stage++;s.rested=false;s.phase=s.stage===2?'delivery':'camp';}return true;}
 function rest(s){if(s.phase!=='camp'||s.rested)return false;s.hours+=2;s.rested=true;for(const u of s.party){if(u.hp>0)u.hp=Math.min(u.max,u.hp+60);u.mp=Math.min(u.maxMp,u.mp+2);}s.history.push('焚き火で休息（2時間）。生存者はHP＋60・MP＋2。戦闘不能はアスタリスの宿屋でのみ回復。');return true;}
 function onward(s){if(s.phase!=='camp')return false;s.phase='road';return true;}
 function deliver(s){if(s.phase!=='delivery')return false;const late=s.hours>s.job.deadline;s.gold=Math.floor(s.job.reward*(late?.65:1));s.xp=late?60:100;s.level=s.xp>=100?2:1;s.outcome=late?'late':'success';s.phase='result';s.history.push(late?'納期後に配達。報酬は65％、経験値60。':'納期内に配達。満額報酬と経験値100。');return true;}
 return {jobs,create,accept,select,depart,hasPorter,randomEnemies,forecast,travel,finishBattle,rest,onward,deliver};
})();
if(typeof module!=='undefined')module.exports=Journey;
