'use strict';
// Definitions and ordered equipment groups come from the validated SQLite master.
const master=require('./master-data.cjs').getMaster();
module.exports={definitions:master.definitions,gear:master.groups.equipmentSkills.map(id=>master.gear.find(g=>g.id===id))};
