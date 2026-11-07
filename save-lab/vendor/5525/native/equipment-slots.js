'use strict';
// Canonical eight-slot view; legacy storage keys preserve v1 saves losslessly.
const slots={rightHand:'右手',leftHand:'左手',head:'頭',upperBody:'上半身',lowerBody:'下半身',feet:'足',accessory1:'装飾1',accessory2:'装飾2'};
const storage=slot=>({rightHand:'weapon',upperBody:'armor'})[slot]||slot;
const canonical=slot=>({weapon:'rightHand',armor:'upperBody'})[slot]||slot;
const allowed=g=>g.hands===2?['rightHand']:g.allowedSlots||(g.slot==='weapon'?['rightHand','leftHand']:g.slot==='armor'?['upperBody']:g.type==='accessory'?['accessory1','accessory2']:[canonical(g.slot)]);
const identity=id=>id; // Legacy accessory -1/-2 IDs are separately purchased copies.
const master=require('./master-data.cjs').getMaster();
const extraGear=master.groups.extra.map(id=>master.gear.find(g=>g.id===id));
module.exports={slots,storage,canonical,allowed,identity,extraGear};
