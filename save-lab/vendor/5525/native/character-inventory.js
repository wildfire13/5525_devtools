'use strict';

// Ownership quantities remain independent of distinct-type capacity and weight.
// Save-format size/numeric guards remain the campaign validator's concern.
const own=(object,key)=>Object.hasOwn(object,key);
const quantity=value=>Number.isSafeInteger(value)&&value>0;
function count(bag,id){return bag&&own(bag,id)?bag[id]:0;}
function add(bag,id,amount){
  if(!quantity(amount)||!Number.isSafeInteger(count(bag,id)+amount))return null;
  return {...bag,[id]:count(bag,id)+amount};
}
function remove(bag,id,amount){
  if(!quantity(amount)||count(bag,id)<amount)return null;
  const next={...bag},remaining=count(bag,id)-amount;
  if(remaining)next[id]=remaining;else delete next[id];
  return next;
}
function transfer(from,to,id,amount){
  const source=remove(from,id,amount),target=source&&add(to,id,amount);
  return source&&target?{source,target}:null;
}
// null is the serializable unlimited-capacity value; never persist Infinity.
function capacity(contributions){
  if(!contributions.every(value=>value===null||Number.isSafeInteger(value)))throw new TypeError('Invalid capacity contribution');
  if(contributions.some(value=>value===null))return null;
  const total=contributions.reduce((sum,value)=>sum+value,0);
  if(!Number.isSafeInteger(total))throw new RangeError('Capacity exceeds safe integer range');
  return Math.max(0,total);
}
function occupancy(bag,limit){
  if(limit!==null&&(!Number.isSafeInteger(limit)||limit<0))throw new TypeError('Invalid capacity');
  const ids=Object.keys(bag).filter(id=>quantity(bag[id]));
  return {used:ids.length,limit,overflow:limit===null?[]:ids.slice(limit)};
}
function canReceive(bag,id,amount,limit){
  const next=add(bag,id,amount);
  return !!next&&occupancy(next,limit).overflow.length===0;
}
// Unknown weights are not silently treated as zero. Report the known subtotal
// separately so UI can distinguish an incomplete master from actual weight 0.
function weight(bag,lookup){
  let known=0;const unknown=[];
  for(const [id,amount] of Object.entries(bag)){
    if(!quantity(amount))continue;
    const value=lookup(id)?.weight;
    if(value===undefined||value===null){unknown.push(id);continue;}
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new TypeError('Invalid item weight');
    known+=value*amount;
    if(!Number.isFinite(known)||known>Number.MAX_SAFE_INTEGER)throw new RangeError('Weight exceeds safe numeric range');
  }
  return {known,total:unknown.length?null:known,unknown};
}
module.exports={quantity,count,add,remove,transfer,capacity,occupancy,canReceive,weight};
