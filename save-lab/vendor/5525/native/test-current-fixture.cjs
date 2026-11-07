'use strict';
// Regression scenarios that use historical character IDs start AFTER the
// approved one-time update migration. Keep real current capacity rules active;
// supply an explicit +5 pouch in the otherwise empty second accessory slot so
// existing inventory/commerce scenarios have space. Tests of migration itself
// use frozen old saves or createLegacy() directly, never this helper.
const C=require('./campaign.js');
module.exports=function currentHistoricalFixture(){
 const s=C.deserialize(C.serialize(C.createLegacy()));
 for(const id of Object.keys(C.createLegacy().characters))s.characters[id].accessory2='pouch-belt-3';
 return s;
};
