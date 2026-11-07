'use strict';
const assert=require('node:assert/strict');
const C=require('./campaign.js'),B=require('./campaign-battle.js'),master=require('./master-data.cjs').getMaster();
const clone=x=>JSON.parse(JSON.stringify(x));
const guard='recruit-guard-human-female',mage='recruit-mage-elf-female';
function start(state){assert(C.depart(state,'east'));assert(C.travel(state,'safe',()=>0));return state.battle;}

// Every physical record has a reviewable provisional Wt. Virtual slots/fists stay weightless.
for(const gear of master.gear){assert.equal(typeof gear.weight,'number',gear.id);assert(gear.weight>=0,gear.id);if(['empty','fist'].includes(gear.type)||gear.virtualDefault)assert.equal(gear.weight,0,gear.id);}
assert.equal(C.items.find(x=>x.id==='potion').weight,1);assert.equal(C.items.find(x=>x.id==='ether').weight,1);
assert(master.gear.find(x=>x.id==='armor-cloth').weight>master.gear.find(x=>x.id==='dagger-wood').weight);
assert(master.gear.some(x=>x.def>0)&&master.gear.some(x=>x.defFire>0)&&master.gear.some(x=>x.defWater>0)&&master.gear.some(x=>x.defEarth>0));
{
 const s=C.create(),c=s.characters[mage],startWt=C.inventoryView(s,mage).weight.total;
 c.leftHand='staff-wood';assert.equal(C.inventoryView(s,mage).weight.total,startWt+master.gear.find(x=>x.id==='staff-wood').weight,'two separate one-hand copies each weigh');
 c.weapon='greatsword-wood';c.leftHand='empty-leftHand';const oneHandRef=C.inventoryView(s,mage).weight.total;c.leftHand='greatsword-wood';assert.equal(C.inventoryView(s,mage).weight.total,oneHandRef,'same two-hand reference weighs once');
}

// STR is the threshold: exactly equal remains normal, one extra Wt halves final SPD.
{
 const s=C.create();s.characters[mage].inventory.potion=4;
 const view=C.inventoryView(s,mage),str=C.stats(s.characters[mage]).str;
 assert.equal(view.weight.total,str);
 let b=start(s),u=b.units.find(x=>x.id===mage);assert.equal(u.overburdened,false);assert.equal(u.agi,u.baseAgi);
}
{
 const s=C.create();s.characters[mage].inventory.potion=5;
 const view=C.inventoryView(s,mage),str=C.stats(s.characters[mage]).str;
 assert.equal(view.weight.total,str+1);
 let b=start(s),u=b.units.find(x=>x.id===mage);assert.equal(u.overburdened,true);assert.equal(u.agi,u.baseAgi*.5);
}

// A KO member's own equipment and bags are shared across the full selected party,
// including the roster member outside the five combat slots. A new KO updates speed.
{
 const s=C.create(),reserve='recruit-guard-elf-female';assert(C.select(s,[...s.selected,reserve]));
 s.characters[guard].hp=0;s.characters[guard].inventory.potion=4;
 const own=C.inventoryView(s,guard).weight.total,alive=s.selected.filter(id=>s.characters[id].hp>0).length;
 const b=start(s);for(const id of s.battleSelected){const u=b.units.find(x=>x.id===id);if(u?.side==='ally'&&u.hp>0)assert.equal(u.fallenWeightShare,own/alive);}
 assert(C.begin(s));const victim=b.units.find(u=>u.side==='ally'&&u.hp>0&&u.id!==b.actor);B.receive(b,victim,10000,false);
 const survivors=b.units.filter(u=>u.side==='ally'&&u.hp>0);assert(survivors.length>0);
 const shares=survivors.map(u=>u.fallenWeightShare);assert(shares.every(value=>value===shares[0]));
 assert(C.validate(s).ok,C.validate(s).error);assert.deepEqual(C.deserialize(C.serialize(s)),clone(s));
}

// Potions cannot revive KO members; only the Astaris inn restores them.
{
 const s=C.create(),c=s.characters[guard];c.hp=0;c.inventory.potion=1;
 assert.equal(C.inventoryQuote(s,guard,'potion','use',guard).ok,false);
 s.phase='camp';s.journey={phase:'camp',rested:false,history:[],party:[{id:guard,hp:0,max:C.stats(c).max,mp:0,maxMp:C.stats(c).maxMp},{id:s.selected[1],hp:10,max:100,mp:0,maxMp:8}]};
 assert(C.rest(s));assert.equal(c.hp,0);assert.equal(s.characters[s.selected[1]].hp,70);
}

// Fire > Earth > Water > Fire. DEF is subtracted before the 25% matchup factor.
{
 const battle=B.create({ally:['mage'],enemy:['guard'],deployment:true}),enemy=battle.units.find(u=>u.side==='enemy');
 enemy.element='earth';enemy.hp=100;enemy.max=100;enemy.defFire=5;
 B.receive(battle,enemy,{physical:0,fire:20,water:0,earth:0},false);assert.equal(enemy.hp,81); // round((20-5)*1.25) = 19
 enemy.element='water';enemy.hp=100;enemy.defFire=5;
 B.receive(battle,enemy,{physical:0,fire:20,water:0,earth:0},false);assert.equal(enemy.hp,89); // round((20-5)*0.75) = 11
 enemy.element='none';enemy.hp=100;enemy.defFire=5;
 B.receive(battle,enemy,{physical:0,fire:20,water:0,earth:0},false);assert.equal(enemy.hp,85);
}

// DEF can reduce damage to zero; it never creates a heal or a forced 1 point hit.
{
 const b=B.create({ally:['guard'],enemy:['guard'],deployment:true}),enemy=b.units.find(u=>u.side==='enemy');enemy.hp=50;enemy.def=10;
 B.receive(b,enemy,1,false);assert.equal(enemy.hp,50);
 B.receive(b,enemy,{physical:0,fire:0,water:0,earth:0},false);assert.equal(enemy.hp,50);
}

// Enemies use a real master weapon, armor and owned consumable inventory; this adds no drop reward.
{
 const s=C.create(),b=start(s),enemy=b.units.find(u=>u.side==='enemy');
 assert(enemy.equipment.rightHand&&enemy.inventory&&enemy.attackWeapons.length===1);
 assert.equal(typeof enemy.inventory.potion,'number');
 assert(C.validate(s).ok,C.validate(s).error);assert.deepEqual(C.deserialize(C.serialize(s)),clone(s));
}

// A v2 battle snapshot written before these combat/weight fields migrates once,
// preserves its original file object, and is stable on a second load.
{
 const s=C.create();start(s);const envelope=JSON.parse(C.serialize(s)),state=envelope.state,b=state.battle;
 for(const c of Object.values(state.characters))delete c.element;
 state.characters[guard].element='none'; // explicit none must survive; an omitted field migrates from the job template.
 for(const key of ['weightRevision','damageRevision','enemyEquipmentRevision','partyAliveInitial','initialDownWeight','reserveDownWeight'])delete b[key];
 for(const u of b.units){
  if(u.side==='ally'){
   const c=state.characters[u.id],st=C.stats(c);u.agi=st.speed;u.def=c.def||0;
   for(const key of ['atkFire','atkWater','atkEarth','defFire','defWater','defEarth','baseAgi','startedAlive','carriedWeight','weightLimit','fallenWeightShare','overburdened','element'])delete u[key];
   u.attackWeapons=u.attackWeapons.map(({slot,itemId,atk,reach,skill})=>({slot,itemId,atk,reach,skill}));
  }else{
   for(const key of ['atkFire','atkWater','atkEarth','defFire','defWater','defEarth','element','equipment','inventory','attackWeapons'])delete u[key];
   u.atk=B.roster.find(t=>t.id===u.id.replace(/^enemy-/,'')).atk;u.agi=B.roster.find(t=>t.id===u.id.replace(/^enemy-/,'')).agi;u.reach=B.roster.find(t=>t.id===u.id.replace(/^enemy-/,'')).reach;u.def=0;delete u.weapon;
  }
 }
 b.potions.enemy=6;const before=clone(envelope),loaded=C.deserialize(envelope);assert.deepEqual(envelope,before);
 assert.equal(loaded.characters[guard].element,'none');assert.equal(loaded.characters[mage].element,'fire');
 assert.equal(loaded.characters['recruit-scout-elf-male'].element,'earth');assert.equal(loaded.characters['recruit-porter-human-male'].element,'none');
 assert.equal(loaded.battle.weightRevision,1);assert.equal(loaded.battle.damageRevision,1);assert(loaded.battle.units.filter(u=>u.side==='enemy').every(u=>u.inventory&&u.equipment));
 assert.equal(loaded.battle.units.filter(u=>u.side==='enemy').reduce((n,u)=>n+(u.inventory.potion||0),0)+(loaded.battle.potions.enemy||0),6);
 assert.deepEqual(C.deserialize(C.serialize(loaded)),loaded);
}

console.log('PASS Wt thresholds, KO sharing, recovery restrictions, elemental damage and enemy loadouts');
