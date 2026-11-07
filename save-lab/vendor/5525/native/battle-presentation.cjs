'use strict';

// Transient presentation state stays outside the battle/save schema.
const observers=new WeakMap(), stepping=new WeakSet();
const clone=value=>JSON.parse(JSON.stringify(value));
function mark(state, actor, kind, target, engine) {
  observers.get(state)?.action(actor,kind,target,engine);
}
function restore(state,snapshot) {
  for(const key of Object.keys(state))delete state[key];
  Object.assign(state,clone(snapshot));
}
function capture(state,engine,run) {
  const frames=[],cleanups=[];
  const initialSequence=state.skillEventSequence||0;
  let current=null, statusAction=null, actionNumber=0;const spoken=new Set();
  const add=(phase,unit,extra={})=>{
    const voiceEvents=(extra.voiceEvents||[]).filter(event=>{
      const key=event.character_id+'/'+event.cue;if(spoken.has(key))return false;spoken.add(key);return true;
    });
    frames.push({phase,unit_id:unit?.id||null,actor_id:current?.id||null,
      action_number:actionNumber,...extra,voiceEvents,state:clone(state)});
  };
  const observer={action(actor,kind,target,eng=engine){
    // enemyAction marks even misses; its nested apply must not duplicate it.
    if(current===actor&&statusAction?.kind===kind)return;
    current=actor;actionNumber++;spoken.clear();
    const cue=kind==='return'?'skill:returnHome':kind==='skill'?'skill:'+eng.activeSkill(actor):'attack';
    add('action',actor,{kind,skill_id:['skill','cast'].includes(kind)?eng.activeSkill(actor):kind==='return'?'returnHome':null,target:clone(target??null),label:actor.name+'：'+
      (kind==='skill'?eng.skillName(actor):({attack:'攻撃',move:'移動',guard:'防御',item:'回復薬',ether:'エーテル',return:'帰還',skip:'足払いで手番をスキップ',cast:'スタンプの構え'}[kind]||kind)),
      voiceEvents:actor.side==='ally'&&['attack','skill','return'].includes(kind)?[{character_id:actor.id,cue}]:[]});
    statusAction=frames[frames.length-1];
    const targets=(Array.isArray(target)?target:[target]).flatMap(id=>{
      const unit=state.units.find(unit=>unit.hp>0&&(typeof id==='number'?unit.pos===id:unit.id===id));
      return unit?[{unit_id:unit.id,cell:unit.pos}]:[];
    });
    const helpers=kind==='skill'&&statusAction.skill_id==='pincer'&&targets.length&&typeof engine.range==='function'
      ?state.units.filter(unit=>unit.hp>0&&unit.side===actor.side&&unit.id!==actor.id&&engine.range(unit,{pos:targets[0].cell})===1).map(unit=>({unit_id:unit.id,cell:unit.pos})):[];
    statusAction.resolved={targets,pincer_success:helpers.length>0,pincer_helpers:helpers};
    if(statusAction.skill_id==='stamp'&&Array.isArray(eng.resolvedCells))statusAction.resolved.cells=clone(eng.resolvedCells);
    if(kind==='skill'&&statusAction.skill_id==='healingCross'&&targets.length&&typeof engine.crossCells==='function')statusAction.resolved.cells=clone(engine.crossCells(targets[0].cell));
    if(kind==='attack'||kind==='skill'){
      // Enemy plans reserve a cell; the original unit id may have moved away.
      // A trajectory may point at an empty reserved cell, but it is never a
      // hit claim. Only the existing hurt packets describe actual recipients.
      const reserved=actor.side==='enemy'&&actor.intent?.kind==='attack'&&actor.intent.cells?.length;
      let recipient=reserved?state.units.find(unit=>unit.hp>0&&unit.side!==actor.side&&unit.pos===actor.intent.cells[0]):state.units.find(unit=>unit.hp>0&&unit.id===targets[0]?.unit_id);
      let targetCell=reserved?actor.intent.cells[0]:typeof target==='number'?target:recipient?.pos;
      if(!Number.isInteger(targetCell)||targetCell<0||targetCell>=50){targetCell=null;recipient=null;}
      const weapons=targetCell!==null&&typeof engine.reachFilteredPower==='function'?clone(engine.reachFilteredPower(actor,{pos:targetCell},kind).weapons):[];
      statusAction.attack_visual={source_cell:actor.pos,target_cell:targetCell,target_unit_id:recipient?.id||null,
        targeting:reserved?'reserved_cell':recipient?'unit':'unknown',weapons,
        abstract:weapons.length===0||weapons.some(weapon=>typeof weapon.itemId!=='string'||!weapon.itemId)};
    }
    if(kind==='skill'&&statusAction.skill_id==='legSweep'&&typeof engine.sweepTargets==='function'){
      // These are resolved presentation results, not a new roll or a state
      // difference. A successful reapplication to an already-active status
      // must remain distinguishable from a failed reapplication.
      statusAction.resolved_status=engine.sweepTargets(state,actor).map(unit=>({
        unit_id:unit.id,cell:unit.pos,status:'skipNextTurn',
        success:false,already_active:!!unit.skipNextTurn,
      }));
    }
  }};
  observers.set(state,observer);stepping.add(state);
  try {
    for(const unit of state.units)for(const key of ['hp','pos','mp']){
      if(!Object.hasOwn(unit,key))continue;
      const descriptor=Object.getOwnPropertyDescriptor(unit,key);let value=unit[key];
      cleanups.push(()=>Object.defineProperty(unit,key,{...descriptor,value}));
      Object.defineProperty(unit,key,{enumerable:true,configurable:true,get:()=>value,set:next=>{
        const previous=value;value=next;
        if(next===previous)return;
        if(key==='mp'&&next<previous)return;
        const phase=key==='mp'?'resource':key==='pos'?'move':next<previous?'hurt':'heal';
        add(phase,unit,{...(phase==='resource'?{resource:'mp',skill_id:statusAction?.skill_id||statusAction?.kind||null}:{}),
          ...(phase==='resource'&&statusAction?.skill_id==='manaGift'&&current?{source_actor_id:current.id,source_cell:current.pos,
            donor_amount:current.mp-statusAction.state.units.find(unit=>unit.id===current.id).mp}:{}),
          ...(phase==='move'?{source_skill:statusAction?.skill_id||null,source_actor_id:current?.id||null,target_id:unit.id}:{}),
          ...(phase==='move'&&unit===current&&statusAction?.skill_id==='poleVault'?{jump:true}:{}),from:previous,to:next,label:unit.name+'：'+
          (phase==='move'?'移動':phase==='resource'?'MP回復 '+(next-previous):phase==='hurt'?'被ダメージ '+(previous-next):'HP回復 '+(next-previous)),
          voiceEvents:phase==='hurt'&&unit.side==='ally'?[{character_id:unit.id,cue:'hurt'},...(previous>0&&next<=0?[{character_id:unit.id,cue:'incapacitated'}]:[])]:[]});
      }});
    }
    for(const unit of state.units)for(const key of ['cover','covers','boost']){
      const descriptor=Object.getOwnPropertyDescriptor(unit,key);let value=unit[key],written=false;
      const get=()=>value;
      cleanups.push(()=>{
        const finalDescriptor=Object.getOwnPropertyDescriptor(unit,key);
        if(!finalDescriptor||finalDescriptor.get!==get)return;
        if(descriptor)Object.defineProperty(unit,key,{...descriptor,value});
        else if(written)Object.defineProperty(unit,key,{value,writable:true,enumerable:true,configurable:true});
        else delete unit[key];
      });
      Object.defineProperty(unit,key,{enumerable:descriptor?.enumerable??false,configurable:true,get,set:next=>{
        value=next;
        if(!descriptor&&!written){
          const observed=Object.getOwnPropertyDescriptor(unit,key);
          delete unit[key];Object.defineProperty(unit,key,{...observed,enumerable:true});
        }
        written=true;
        if(!statusAction||unit!==current||statusAction.kind!=='skill')return;
        const skill=statusAction.skill_id;
        if(!((key==='cover'&&skill==='guard'&&typeof next==='string')||(key==='covers'&&skill==='defenseLine'&&Array.isArray(next)&&next.length)||(key==='boost'&&skill==='porter'&&next===true)))return;
        const ids=key==='boost'?[unit.id]:key==='cover'?[next]:next;
        if(key==='boost')statusAction.resolved.cells=state.units.filter(recipient=>recipient.hp>0&&recipient.side===unit.side).map(recipient=>recipient.pos);
        for(const id of ids){const recipient=state.units.find(unit=>unit.id===id);if(recipient)(statusAction.resolved_support||=[]).push({unit_id:id,cell:recipient.pos,status:key,success:true});}
      }});
    }
    for(const unit of state.units){
      const key='skipNextTurn',descriptor=Object.getOwnPropertyDescriptor(unit,key);
      let value=unit[key],written=false;
      const get=()=>value;
      cleanups.push(()=>{
        const finalDescriptor=Object.getOwnPropertyDescriptor(unit,key);
        // advance() may consume the status with delete, or the rule may
        // redefine it. Neither operation may be undone by observation.
        if(!finalDescriptor||finalDescriptor.get!==get)return;
        if(descriptor)Object.defineProperty(unit,key,{...descriptor,value});
        else if(written)Object.defineProperty(unit,key,{value,writable:true,enumerable:true,configurable:true});
        else delete unit[key];
      });
      Object.defineProperty(unit,key,{enumerable:true,configurable:true,get,set:next=>{
        value=next;written=true;
        if(next===true){
          const result=statusAction?.resolved_status?.find(row=>row.unit_id===unit.id);
          if(result)result.success=true;
        }
      }});
    }
    const ok=run();
    if(ok)add('settled',current,{label:'行動結果'});
    if(ok)for(const action of frames.filter(row=>row.phase==='action'&&row.skill_id==='healingCross'))action.resolved_heals=frames.filter(row=>row.action_number===action.action_number&&row.phase==='heal'&&row.to>row.from).map(row=>({unit_id:row.unit_id,cell:row.state.units.find(unit=>unit.id===row.unit_id).pos,amount:row.to-row.from}));
    if(ok)for(const event of (state.skillEvents||[]).filter(event=>event.sequence>initialSequence&&event.classification==='passive')){
      const first=frames.findIndex(frame=>(frame.state.skillEventSequence||0)>=event.sequence);
      if(first<0)continue;
      const frame=frames[first],number=frame.action_number;
      let packet;
      if(event.skillId==='victoryBreath'){
        packet=event.amount>0?frames.slice(0,first+1).reverse().find(row=>row.phase==='resource'&&row.unit_id===event.actorId&&row.action_number===number&&!row.triggered_passives):null;
        if(packet)packet.skill_id='victoryBreath';
        else packet=frames.find(row=>row.phase==='settled'&&row.action_number===number)||frames[frames.length-1];
      }else{
        const phase=event.skillId==='firstStride'?'move':event.skillId==='loneWolf'?'hurt':null;
        packet=phase?frames.slice(first).find(row=>row.action_number===number&&row.phase===phase&&(event.skillId!=='firstStride'||row.unit_id===event.actorId)):null;
      }
      const unit=(packet||frame).state.units.find(unit=>unit.id===event.actorId);
      const resolved={...clone(event),cell:unit?.pos??null};
      if(packet)(packet.triggered_passives||=[]).push(resolved);
      const action=frames.find(row=>row.phase==='action'&&row.action_number===number);
      if(action)(action.resolved_passives||=[]).push(resolved);
    }
    return {ok,frames:ok?frames:[]};
  } finally {
    cleanups.forEach(fn=>fn());observers.delete(state);stepping.delete(state);
  }
}

class Presentation {
  constructor(){this.serial=0;this.pending=null;}
  start(state,engine,run,onComplete=()=>{}) {
    if(this.pending)throw Error('演出中です');
    const before=clone(state);
    let result;
    try {result=capture(state,engine,run);} catch(error){restore(state,before);throw error;}
    if(!result.ok){restore(state,before);return false;}
    this.pending={id:++this.serial,index:0,state,engine,frames:result.frames,offset:0,batch:0,onComplete};
    this.show();return true;
  }
  show(){const p=this.pending;restore(p.state,p.frames[p.offset].state);}
  info(){
    const p=this.pending;if(!p)return null;
    const {state,...frame}=p.frames[p.offset];
    return {id:p.id,index:p.index,action_id:`${p.id}:${p.batch}:${frame.action_number}`,impact_group_id:0,...frame};
  }
  next(id,index){
    const p=this.pending;
    if(!p||p.id!==id||p.index!==index)return false;
    p.index++;p.offset++;
    if(p.offset<p.frames.length){this.show();return true;}
    const actor=p.state.units.find(u=>u.id===p.state.actor);
    if(!p.state.result&&actor?.side==='enemy'&&p.engine.stepEnemy){
      const result=capture(p.state,p.engine,()=>p.engine.stepEnemy(p.state));
      if(!result.ok)throw Error('敵行動を進められません');
      p.frames=result.frames;p.offset=0;p.batch++;this.show();return true;
    }
    this.pending=null;p.onComplete();return true;
  }
  finish(id){
    if(!this.pending||this.pending.id!==id)return false;
    // Closing a window settles the already accepted action once, silently.
    while(this.pending)this.next(this.pending.id,this.pending.index);
    return true;
  }
}
module.exports={mark,isStepping:state=>stepping.has(state),capture,Presentation};
