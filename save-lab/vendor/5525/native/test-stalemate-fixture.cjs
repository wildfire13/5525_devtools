'use strict';
// Current production start and public operations only. The historical save now
// correctly migrates to town, so it must not seed a continuing battle here.
const C=require('./campaign.js'),assert=require('node:assert/strict');
module.exports=function(){
 const s=C.create();assert(C.select(s,['recruit-porter-human-female']));
 assert(C.depart(s,'east'));assert(C.travel(s,'safe',()=>.999));assert(C.begin(s));
 for(let n=0;n<52;n++)assert(C.act(s,'guard',null));
 assert.equal(s.battle.result,null);assert(C.validate(s).ok,C.validate(s).error);return s;
};
