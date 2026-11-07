'use strict';
const PREFIX='quest-cargo:';
const key=token=>PREFIX+token;
const isKey=id=>typeof id==='string'&&id.startsWith(PREFIX);
function definition(s,id){
 const q=s.activeQuest;
 return q&&q.cargoItemId===id?{id,name:'荷物',description:q.cargo,questId:q.id,questToken:q.token}:null;
}
function carriers(s){
 const q=s.activeQuest;if(!q?.cargoItemId)return [];
 return Object.keys(s.characters).filter(id=>s.characters[id].inventory?.[q.cargoItemId]===1);
}
function aboard(s){return carriers(s).some(id=>s.selected.includes(id));}
function issue(s,owner){
 const q=s.activeQuest;q.cargoItemId=key(q.token);q.cargoOwnerId=owner;
 s.characters[owner].inventory[q.cargoItemId]=1;
}
function consume(s){
 const q=s.activeQuest,owner=carriers(s).find(id=>s.selected.includes(id));
 if(!owner)return false;
 delete s.characters[owner].inventory[q.cargoItemId];return true;
}
function validEntry(s,owner,id,count){
 const q=s.activeQuest;
 return !!q&&id===q.cargoItemId&&id===key(q.token)&&q.cargoOwnerId===owner&&count===1;
}
module.exports={key,isKey,definition,carriers,aboard,issue,consume,validEntry};
