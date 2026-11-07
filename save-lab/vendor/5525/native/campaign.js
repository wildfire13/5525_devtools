'use strict';
// Replayable native prototype adapter. The frozen Journey/Battle defaults are
// still usable independently. Every number, road, offer and shop item below is
// a PROVISIONAL playtest choice, not a newly settled design decision.
const B = require('./campaign-battle.js');
const J = require('./journey.js');
const E = require('./equipment-skills.js');
const S = require('./equipment-slots.js');
const I = require('./character-inventory.js');
const Cargo = require('./quest-cargo.js');
const {createHash,randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const Campaign = (() => {
  const INN_PRICE = 30; // Whole active party, provisional playtest price.
  const VERSION = 2, MAX_SAVE_BYTES = 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  const inventoryEpochs=new WeakMap();
  function inventoryEpoch(s){if(!inventoryEpochs.has(s))inventoryEpochs.set(s,{id:randomUUID(),revision:0});return inventoryEpochs.get(s);}
  function invalidateInventory(s){inventoryEpoch(s).revision++;}
  const locations = [
    {id:'astaris',name:'アスタリス',kind:'city',facilities:['board','guild','inn']},
    {id:'east',name:'イース',kind:'village',facilities:['board','weapon']},
    {id:'west',name:'ウエス',kind:'village',facilities:['board','armor']},
    {id:'south',name:'サウス',kind:'village',facilities:['board','items']},
    {id:'north',name:'ノース',kind:'village',facilities:['board','accessory']},
  ];
  const materials = {
    wood:{name:'木製',metal:false},iron:{name:'鉄製',metal:true},
    silver:{name:'銀製',metal:true},cloth:{name:'布製',metal:false},leather:{name:'革製',metal:false},
    glass:{name:'ガラス',metal:false},steel:{name:'鋼',metal:true},
  };
  // Legacy IDs retained; weapon/armor storage keys now mean right hand/upper body.
  const gear = require('./master-data.cjs').getMaster().gear;
  const items = [
    {id:'potion',name:'ポーション',price:40,amount:55,resource:'hp',battleKind:'item',weight:1},
    {id:'ether',name:'エーテル',price:30,amount:3,resource:'mp',battleKind:'ether',battleRole:'porter',weight:1},
  ];
  const skills = {guard:'かばう',archer:'スナイプ',mage:'ヒール',scout:'奇襲',stamp:'スタンプ',porter:'陣形強化',...Object.fromEntries(Object.entries(E.definitions).map(([id,d])=>[id,d.name]))};
  const provisional = [
    '地名・商品・価格・能力・成長値・依頼・経路は試遊用の仮設定です',
    '中央と各村、および隣接する村同士を結ぶ道路。各村から3方向へ移動できます',
    '装備は右手・左手・頭・上半身・下半身・足・装飾2枠。両手剣・両手槍は左右2枠を占有します',
    '防具の保護を最大HP増加で仮表現。武器スキル・材質・要求能力に差があります',
    'C01は保留。ポーターの攻撃不可を維持し、買い替えても攻撃スキルを有効化しません',
    '失敗時は受注直前（未受注移動は出発直前）の所持金・装備・編成・HP/MP・アイテム・EXP・経過時間へ復元します',
    'セーブはこの試作の単一データJSON。職解放・別セーブ統合・本開発の引継ぎを確定しません',
  ];
  const getGear = id => gear.find(g=>g.id===id);
  const getPlace = id => locations.find(p=>p.id===id);
  const template = id => B.roster.find(c=>c.id===id);
  const rosterFor=s=>B.roster.filter(t=>Object.hasOwn(s.characters||{},t.id));
  const bases = {
    guard:{race:'human',str:16,int:8,agi:10,weapon:'sword-wood'},
    archer:{race:'human',str:12,int:8,agi:14,weapon:'bow-wood'},
    mage:{race:'elf',str:14,int:16,agi:11,weapon:'staff-wood'},
    scout:{race:'elf',str:10,int:9,agi:13,weapon:'dagger-wood'},
    porter:{race:'human',str:14,int:10,agi:12,weapon:'porter-kit'},
    warrior:{race:'dwarf',str:18,int:8,agi:10,weapon:'hammer-iron-1'},
  };
  // Standalone story calendars are a playtest schedule. New games start at
  // world hour 0; an older save receives the calendar at its current hour.
  const STANDALONE_QUESTS = [
    {eventId:'turnip',from:'north',to:'astaris',name:'世界一のカブ',client:'農夫',cargo:'大きなカブ',weight:8,deadline:18,reward:240,xp:100,portrait:'farmer',cast:['farmer','weigher'],story:[['farmer','今年のは勝つ。持てば分かる。'],['farmer','アスタリスの品評会まで、丸ごと頼めるか。俺は先に行って、受付を済ませる。'],['farmer','計量が終わったら、どんな大物でも出せない。そこだけは頼むぞ。']],successStory:[['weigher','出品のカブですね。こちらへ。'],['narration','カブを載せると、秤の針が大きく振れた。'],['farmer','見たか。……まだ他にも来るのか？'],['weigher','締切までは受け付けます。'],['farmer','ともかく、間に合った。約束の礼だ。']]},
    {eventId:'kiln',from:'astaris',to:'east',name:'最後の窯',client:'若い陶工',cargo:'包みの器',weight:2,deadline:20,reward:150,xp:100,portrait:'apprentice',cast:['apprentice','master'],story:[['narration','若い陶工が、包みの結び目を確かめている。'],['apprentice','師匠が、最後に窯を焚くんだ。'],['apprentice','これを一つ、入れてもらいたくて。最後まで直していたら、こんな時間だ。'],['apprentice','イースの工房まで、届けてくれる？']],successStory:[['master','あの子のかい。見せてごらん。'],['master','底が厚い。昔からだ。'],['narration','師匠は器を傾けて見てから、ほかの器の隣へ置いた。'],['master','入るよ。まだ閉じてない。'],['master','次は薄く作れ、と伝えておくれ。']]},
    {eventId:'wheel',from:'east',to:'astaris',name:'宛先は、こっちへ来る',client:'車輪職人',cargo:'替えの車輪',weight:6,deadline:24,reward:220,xp:100,lateDeadline:36,lateReward:110,portrait:'wheelwright',cast:['wheelwright','merchant'],story:[['narration','職人が、完成した車輪を立てて転がりを確かめている。'],['wheelwright','替えの車輪だ。あの行商人に届けてくれ。'],['wheelwright','本人から、受け取る場所と時刻が届いてる。追うより、先で待つ方が早いかもな。'],['wheelwright','今の輪は、ひびが入ってる。次の市までは、持たんかもしれん。']],successStory:[['merchant','あっ、それ！ 助かった。走るたびに音がしてたのよ。'],['narration','行商人が古い車輪を外し、新しい輪を取り付ける。'],['merchant','これなら、市に間に合う。'],['merchant','約束の分ね。今度は、うちで買い物もしていって。']],lateStory:[['narration','傾いた荷車の脇で、行商人が荷物を下ろしている。'],['merchant','……ああ、替えの車輪ね。見てのとおりよ。'],['merchant','市には、もう間に合わない。でも、ここからは動ける。'],['merchant','報酬は約束どおり、半分。車輪は受け取るわ。']]}
  ];
  const SCENARIO_BY_ID=Object.fromEntries(STANDALONE_QUESTS.map(q=>[q.eventId,q]));
  const SCENARIO_DEADLINE_REASON='納品期限を過ぎました。世界の時刻は巻き戻りません。';
  function freshWorldEvents(epoch=0){return {epoch,events:Object.fromEntries(STANDALONE_QUESTS.map(q=>[q.eventId,{status:'available'}]))};}
  function syncWorld(s){
    if(!Number.isSafeInteger(s.worldTime))s.worldTime=s.hours;
    if(!s.standaloneEvents||typeof s.standaloneEvents!=='object')s.standaloneEvents=freshWorldEvents(s.worldTime);
    for(const q of STANDALONE_QUESTS){const e=s.standaloneEvents.events?.[q.eventId];if(e?.status==='available'&&s.worldTime>s.standaloneEvents.epoch+q.deadline)e.status='missed';}
  }
  function tickWorld(s,hours){syncWorld(s);s.worldTime+=hours;syncWorld(s);if(s.activeQuest?.eventId==='wheel')refreshWheelQuest(s,s.activeQuest);}
  function worldAge(s,id){syncWorld(s);return s.worldTime-s.standaloneEvents.epoch;}
  const MERCHANT_STOPS=[{stop:'astaris',from:10,to:18,endInclusive:false},{stop:'south',from:18,to:36,endInclusive:true}];
  function merchantSchedule(age){
    const currentWindow=MERCHANT_STOPS.find(w=>age>=w.from&&(w.endInclusive?age<=w.to:age<w.to))||null;
    return {currentWindow,currentStop:currentWindow?.stop||null,nextStop:MERCHANT_STOPS.find(w=>age<w.from)||null};
  }
  // Pure projection: never stores UI state or changes a contract/destination.
  function recipientMeeting(s,q=s.activeQuest,options={}){
    if(q?.eventId!=='wheel')return null;
    const epoch=q.eventEpoch??s.standaloneEvents?.epoch??s.worldTime;
    const age=options.age??(s.worldTime-epoch),location=options.location??s.location,phase=options.phase??s.phase;
    const {currentWindow,currentStop,nextStop}=merchantSchedule(age);
    const townWindow=MERCHANT_STOPS.find(w=>w.stop===location)||null;
    const futureTownStop=townWindow&&age<townWindow.from?townWindow:null;
    const accepted=!!s.activeQuest&&s.activeQuest.token===q.token&&s.activeQuest.id===q.id;
    const cargoAboard=accepted&&Cargo.aboard(s),canWait=accepted&&phase==='town'&&!!futureTownStop;
    const handoffReason=!accepted?'not_accepted':phase!=='town'?'not_in_town':age>36?'departed':futureTownStop?'before_arrival':currentStop!==location?'wrong_town':!cargoAboard?'cargo_missing':'available';
    const waitHours=futureTownStop?futureTownStop.from-age:0,worldTime=epoch+age;
    return {schedule:MERCHANT_STOPS.map(w=>({...w})),recipient:'行商人',age,worldTime,location,state:age<10?'in_transit':age>36?'departed':'at_stop',
      currentStop,currentWindow:currentWindow?{...currentWindow}:null,nextStop:nextStop?{...nextStop}:null,globalNextStop:nextStop?{...nextStop}:null,
      townWindow:townWindow?{...townWindow}:null,localWindow:townWindow?{...townWindow}:null,futureTownStop:futureTownStop?{...futureTownStop}:null,
      handoffAvailable:handoffReason==='available',canDeliver:handoffReason==='available',handoffReason,reason:handoffReason,cargoAboard,
      canWait,waitHours,waitPreferredMet:!!futureTownStop&&futureTownStop.from<=q.deadline,waitUntilAge:futureTownStop?.from??null,waitUntilWorldTime:futureTownStop?epoch+futureTownStop.from:null,waitUntil:futureTownStop?epoch+futureTownStop.from:null,
      waitExpected:{questToken:q.token??null,location,worldTime,waitHours},
      deadline:q.deadline,lateDeadline:q.lateDeadline,preferredMet:age<=q.deadline,preferredRemaining:Math.max(0,q.deadline-age),preferredBoundary:age===q.deadline,atPreferredBoundary:age===q.deadline,
      finalOpen:age<=q.lateDeadline,finalRemaining:Math.max(0,q.lateDeadline-age),finalBoundary:age===q.lateDeadline,atFinalBoundary:age===q.lateDeadline,
      canSettleFailure:accepted&&phase==='town'&&!!getPlace(location)&&age>q.lateDeadline,
      failureExpected:{questToken:q.token??null,location,worldTime}};
  }
  function refreshWheelQuest(s,q){
    const m=recipientMeeting(s,q),stop=m.currentStop||m.nextStop?.stop||'south';
    q.to=stop;
    q.text=m.state==='departed'?'行商人はサウスを出発しました。どの町でも期限切れを確認すると、荷物と受注前の状態へ戻ります。世界の時刻は巻き戻りません。':questText({to:stop,cargo:q.cargo});
  }
  function wheelPresentation(s,q){
    if(q?.eventId!=='wheel')return q;
    const shown=clone(q);refreshWheelQuest(s,shown);const m=recipientMeeting(s,q);
    shown.meeting=m;
    shown.merchantAtStop=m.currentStop===s.location;
    shown.merchantCurrentStop=m.currentStop;
    shown.merchantTraveling=m.state==='in_transit';
    shown.merchantCanWait=m.canWait;
    shown.merchantWaitHours=m.waitHours;
    shown.merchantWindow=m.currentWindow||m.nextStop;
    shown.merchantDeparted=m.state==='departed';
    return shown;
  }
  const elements={guard:'earth',archer:'water',mage:'fire',scout:'earth',porter:'none',warrior:'earth'};
  const enemyLoadout={guard:{weapon:'sword-wood',shield:'guard-shield-wood',inventory:{potion:99}},archer:{weapon:'bow-wood',inventory:{potion:99}},mage:{weapon:'staff-wood',inventory:{potion:99}},scout:{weapon:'dagger-wood',inventory:{potion:99}},porter:{weapon:'porter-kit',inventory:{potion:99}},warrior:{weapon:'hammer-iron-1',inventory:{potion:99}}};
  function equipment(c,replacement) {
    const out=Object.fromEntries(Object.keys(S.slots).map(slot=>[slot,c[S.storage(slot)]||(slot.startsWith('accessory')?defaultAccessory(c,slot):`empty-${slot}`)]));
    if(replacement){out[S.canonical(replacement.targetSlot||replacement.slot)]=replacement.id;if(replacement.hands===2)out.leftHand='empty-leftHand';}
    return out;
  }
  function effectiveGear(c,slot,id,eq=equipment(c)) {
    const g=getGear(id);
    if(c.combatRevision!==1)return id==='longspear-wood'?{...g,skill:undefined}:g;
    if(['rightHand','leftHand'].includes(slot)&&g?.type==='empty'&&!(slot==='leftHand'&&getGear(eq.rightHand)?.hands===2)) {
      const fist=getGear(template(c.id).job==='porter'?'fist-2':'fist');
      return {...fist,id,type:'empty',virtualDefault:true};
    }
    return g;
  }
  function gearGrants(g) {
    const canonical=getGear(g.id),same=g.skill===canonical?.skill&&g.effect===canonical?.effect;
    return same?(require('./master-data.cjs').getMaster().grantsByEquipment[g.id]||[]).filter(x=>x.sourceField!=='legacySkill'):[g.skill,g.effect].filter(Boolean).map((id,index)=>({id,level:g.skillLevel??1,slotNo:index+1}));
  }
  function displayGear(g) {
    return {...clone(g),skillGrants:gearGrants(g).map(({id,level,slotNo})=>({id,level,slotNo}))};
  }
  function stats(c,replacement) {
    const t=template(c.id),base=bases[t.job],eq=equipment(c,replacement),entries=Object.entries(eq).map(([slot,id])=>({slot,gear:c.equipmentRevision===2?effectiveGear(c,slot,id,eq):{...getGear(id),skill:id==='longspear-wood'?undefined:getGear(id)?.legacySkill||getGear(id)?.skill}}));
    const w=entries.find(e=>['rightHand','leftHand'].includes(e.slot)&&e.gear.type!=='empty'&&(e.gear.atk||0)>0)?.gear||getGear('empty-rightHand');
    const skillSources=entries.flatMap(({slot,gear:g})=>{
      // Effective virtual fists and old save revisions retain their legacy contract.
      const grants=gearGrants(g);
      return grants.map(({id,level,slotNo})=>({id,slot,itemId:g.id,grantSlot:slotNo,classification:E.definitions[id]?.classification||(id==='invasion'?'passive':'active'),...(['scout','itemUse','archer','legSweep','grapple','poleVault','secretPouch','holePouch'].includes(id)?{level}: {})}));
    });
    const countEffect=id=>skillSources.filter(source=>source.id===id).length;
    const racialStr=countEffect('dwarfProof')*c.level,racialInt=countEffect('elfProof')*c.level;
    const str=base.str+c.allocations.str+racialStr,int=base.int+c.allocations.int+racialInt,agi=base.agi+c.allocations.agi;
    const speedBonus=10*(countEffect('speedUp')-countEffect('speedDown'));
    const supplied=[...new Set(skillSources.filter(x=>x.classification==='active'&&x.id!=='returnHome').map(x=>x.id))];
    const activeSkills=t.job==='porter'?['porter',...supplied.filter(id=>['itemUse','legSweep','grapple','poleVault'].includes(id))]:supplied;
    const effects=[...new Set(skillSources.filter(x=>x.classification==='passive'||x.id==='returnHome').map(x=>x.id))];
    const attackWeapons=t.job==='porter'?[]:entries.filter(e=>['rightHand','leftHand'].includes(e.slot)&&e.gear.type!=='empty'&&['atk','atkFire','atkWater','atkEarth'].some(key=>(e.gear[key]||0)>0)).map(({slot,gear:g})=>({slot,itemId:g.id,name:g.name,atk:g.atk||0,atkFire:g.atkFire||0,atkWater:g.atkWater||0,atkEarth:g.atkEarth||0,reach:g.reach,skill:g.skill||null}));
    const attackBonus=t.job==='porter'?0:Math.floor(c.allocations.str/2);
    const sum=key=>entries.reduce((n,e)=>n+(e.gear[key]||0),0);
    return {str,int,agi,element:c.element||'none',attributeBreakdown:{str:{base:base.str,growth:c.allocations.str,equipment:racialStr},int:{base:base.int,growth:c.allocations.int,equipment:racialInt},speed:{agi,equipment:sum('agiBonus')+speedBonus}},effects,activeSkills,skillSources,attackWeapons,attackBonus,normalReach:Math.max(0,...attackWeapons.map(w=>w.reach)),equipment:eq,weaponType:w.type,max:t.max+sum('hp')+3*c.allocations.str,maxMp:t.mp+Math.floor(c.allocations.int/2)+sum('mp'),
      atk:t.job==='porter'?0:(w.atk||0)+Math.floor(c.allocations.str/2),atkFire:attackWeapons.reduce((n,x)=>n+x.atkFire,0),atkWater:attackWeapons.reduce((n,x)=>n+x.atkWater,0),atkEarth:attackWeapons.reduce((n,x)=>n+x.atkEarth,0),
      def:(c.def??0)+sum('def'),defFire:sum('defFire'),defWater:sum('defWater'),defEarth:sum('defEarth'),reach:t.job==='porter'?0:w.reach||1,
      speed:Math.max(1,agi+sum('agiBonus')+speedBonus),skill:activeSkills[0]||null};
  }
  function weightLookup(s,id){return Cargo.isKey(id)?(Cargo.definition(s,id)?{weight:s.activeQuest.weight}:null):getGear(id)||items.find(item=>item.id===id);}
  function carriedWeight(s,id){
    const c=s.characters[id],bag=I.weight(c.inventory,key=>weightLookup(s,key));
    const eq=equipment(c),seenTwoHand=new Set();let equipped=0;
    for(const [slot,itemId] of Object.entries(eq)){
      const g=getGear(itemId);if(!g||g.type==='empty'||g.type==='fist'||g.virtualDefault)continue;
      if(['rightHand','leftHand'].includes(slot)&&g.hands===2){if(seenTwoHand.has(itemId))continue;seenTwoHand.add(itemId);}
      equipped+=g.weight??1;
    }
    const total=bag.total===null?null:bag.total+equipped;
    return {known:bag.known+equipped,total,unknown:bag.unknown};
  }
  function weightLoads(s,battle=null){
    const hp=id=>battle?.units.find(u=>u.side==='ally'&&u.id===id)?.hp??s.characters[id].hp;
    const alive=s.selected.filter(id=>hp(id)>0),fallen=s.selected.filter(id=>hp(id)<=0);
    const downWeight=fallen.reduce((n,id)=>n+(carriedWeight(s,id).total??0),0),share=alive.length?downWeight/alive.length:0;
    return Object.fromEntries(s.selected.map(id=>[id,{own:carriedWeight(s,id),fallenShare:hp(id)>0?share:0,burden:hp(id)>0?share:0,total:(carriedWeight(s,id).total??0)+(hp(id)>0?share:0)}]));
  }
  const defaultAccessory=(c,slot)=>slot==='accessory1'&&template(c.id).job==='scout'?'invasion-charm-1':`empty-${slot}`;
  function character(id) {
    const t=template(id),base=bases[t.job];
    const c={id,equipmentRevision:2,combatRevision:1,inventory:{},element:elements[t.job]||'none',...(t.job==='guard'?{leftHand:'guard-shield-wood'}:{}),race:t.race??base.race,weapon:base.weapon,armor:'armor-cloth',hp:t.max,mp:t.mp,def:0,xp:0,level:1,statPoints:0,skillPoints:0,allocations:{str:0,int:0,agi:0}};
    if(t.recruitRevision===1){
      c.sex=t.sex;
      c.weapon=t.job==='porter'?'porter-whistle':t.race==='dwarf'&&['guard','scout'].includes(t.job)?'onehand-hammer-wood':base.weapon;
      c.leftHand=t.job==='guard'?'guard-shield-wood':'empty-leftHand';
      c.head=t.race==='human'?'empty-head':t.race+'-hair-ornament';
      c.lowerBody=t.sex==='male'?'cloth-lowerBody':'cloth-skirt';c.feet='cloth-feet';
      c.accessory1='pouch-belt';c.accessory2=t.job==='porter'?'porter-bag':t.job==='scout'?'stealth-cloak':'empty-accessory2';
    }
    return c;
  }
  function createLegacy() {
    const state={version:VERSION,phase:'town',location:'astaris',gold:180,partyRP:0,xp:0,level:1,hours:0,worldTime:0,standaloneEvents:freshWorldEvents(0),
      selected:['guard','archer','mage','scout','porter'],characters:Object.fromEntries(B.legacyRoster.map(t=>[t.id,character(t.id)])),
      activeQuest:null,journey:null,battle:null,rollback:null,
      sequence:0,boardRound:0,completed:0,result:null,history:['アスタリスに到着。繰り返し遊べる試作を開始。']};
    state.cargoRevision=1;state.characters[state.selected[0]].inventory={potion:3,ether:1};return state;
  }
  function create(){
    const s=createLegacy();
    s.characters=Object.fromEntries(B.recruitRoster.map(t=>[t.id,character(t.id)]));
    s.selected=['recruit-guard-human-female','recruit-scout-human-female','recruit-mage-elf-female','recruit-scout-elf-male','recruit-porter-human-female'];
    s.updatePlanRevision=1;s.inventoryRevision=1;s.warehouse={};
    return s;
  }
  function inventoryTotals(s,ids=s.selected) {
    return Object.fromEntries(items.map(item=>[item.id,ids.reduce((n,id)=>n+I.count(s.characters[id]?.inventory,item.id),0)]));
  }
  function inventoryToken(s) {
    return createHash('sha256').update(JSON.stringify([inventoryEpoch(s),s.version,s.phase,s.location,s.selected,s.gold,s.characters,s.sequence,s.warehouse])).digest('hex');
  }
  function inventoryCapacity(s,ownerId){
    // Older saves stay unrestricted until the complete update migration is enabled.
    if(s.inventoryRevision!==1)return null;
    const values=stats(s.characters[ownerId]).skillSources.map(source=>{
      if(source.id==='fourDimensional')return null;
      if(source.id==='secretPouch')return [0,1,3,5][source.level??1];
      if(source.id==='holePouch')return -[0,1,3,5][source.level??1];
      return 0;
    });
    return I.capacity(values);
  }
  function inventoryOverflow(s){return s.selected.filter(id=>I.occupancy(s.characters[id].inventory,inventoryCapacity(s,id)).overflow.length>0);}
  function note(s,text) {s.history.push(text);if(s.history.length>200)s.history.splice(0,s.history.length-200);}
  function hasPorter(s) {return s.selected.some(id=>template(id)?.job==='porter');}
  // R08: center spokes plus the bidirectional east-north-west-south ring.
  const routes={astaris:['east','west','south','north'],east:['north','astaris','south'],north:['east','astaris','west'],west:['north','astaris','south'],south:['east','astaris','west']};
  function destinations(s) {return (routes[s.location]||[]).map(getPlace);}
  // Preserve this exact legacy template only to recognize old saved quest copy.
  // Development purpose and alternate prices belong here, not in player text.
  const LEGACY_QUEST_TEXT="繰り返しの受注・移動・買い替えを確かめる仮の配達依頼です。急ぎは納期6時間・報酬180G、通常は10時間・150G。";
  function questText(q) {return `${q.cargo}を${getPlace(q.to).name}まで届けてください。`;}
  function displayQuest(q,s) {
    if(!q)return q;
    const shown=q.eventId==='wheel'?wheelPresentation(s,q):clone(q);
    shown.rewards=questRewards(q);
    shown.rewardType=q.rewardType||'money';
    if(q.text===LEGACY_QUEST_TEXT&&locations.some(p=>p.id===q.from)&&locations.some(p=>p.id===q.to)&&
       new RegExp(`^${q.from}-${q.to}-[0-9]+-[0-9]+$`).test(q.id))shown.text=questText(q);
    return shown; // Presentation only: never rewrite the saved quest or journey.
  }
  // Revisionless accepted quests retain their original character EXP contract.
  function questRewards(q) {
    const type=q.rewardType==='experience'?'experience':'money';
    const base=q.eventId?(q.eventId==='wheel'?q.lateReward:0):Math.floor(q.reward*.65);
    const baseRP=q.rewardRevision===1?(q.eventId&&q.eventId!=='wheel'?0:Math.min(60,q.xp)):0;
    return {type,base,bonus:q.reward-base,baseRP,bonusRP:q.rewardRevision===1?q.xp-baseRP:0,legacyXP:q.rewardRevision!==1};
  }
  function board(s) {
    if(s.phase!=='town'||s.activeQuest)return [];
    const choices=s.location==='astaris'?[locations[1+s.boardRound%4],locations[1+(s.boardRound+1)%4]]:destinations(s);
    const offers=choices.map((p,i)=>{
      const urgent=s.location==='astaris'?i===0:s.boardRound%2===0;
      const flavors={east:['鍛冶職人リタ','鍛冶場の包帯'],west:['仕立屋エマ','染料の小瓶'],south:['薬師イネス','診療所の薬箱'],north:['村の世話役ノア','雪道の灯油'],astaris:['ギルド受付サラ','村からの修理部品']},[client,cargo]=flavors[p.id];
      return {id:`${s.location}-${p.id}-${s.boardRound}-${i}`,from:s.location,to:p.id,
        name:`${p.name}へ、${urgent?'急ぎの'+cargo:'修理用の部品箱'}（仮）`,client:client+'（仮）',
        cargo:urgent?cargo:'修理用の部品箱',weight:urgent?3:5,deadline:urgent?6:10,reward:urgent?180:150,xp:100,rewardRevision:1,rewardType:s.location==='astaris'&&p.id==='west'&&!urgent?'experience':'money',
        text:questText({to:p.id,cargo:urgent?cargo:'修理用の部品箱'})};
    });
    syncWorld(s);
    for(const q of STANDALONE_QUESTS){
      if(q.from!==s.location||s.standaloneEvents.events[q.eventId]?.status!=='available')continue;
      const event={...clone(q),rewardRevision:1,rewardType:'money',id:`standalone-${q.eventId}`,text:`${q.cargo}を${getPlace(q.to).name}まで届けてください。`,scenario:true,postedAt:s.standaloneEvents.epoch,deadlineAt:s.standaloneEvents.epoch+q.deadline};
      offers.push(q.eventId==='wheel'?wheelPresentation(s,event):event);
    }
    return offers.map(q=>displayQuest(q,s));
  }
  function scenarioAftermath(s){
    syncWorld(s);const out=[],events=s.standaloneEvents.events,here=s.location;
    if(events.turnip?.status==='missed'&&here==='north')out.push({id:'turnip-aftermath',name:'品評会のあと',portrait:'farmer',story:[['narration','畑の脇に、今年の一位を知らせる札が掛かっている。'],['farmer','見たか、今年の一位。あれなら……いや、何でもない。']]});
    if(events.turnip?.status==='completed'&&worldAge(s,'turnip')>=18&&here==='north')out.push({id:'turnip-result',name:'品評会の後日談',portrait:'farmer',story:[['narration','畑の脇に、二位の札が飾ってある。'],['farmer','雨で傷むといかんからな。屋根だけ付けた。']]});
    if(events.kiln?.status==='missed'&&here==='east')out.push({id:'kiln-aftermath',name:'窯のあと',portrait:'',story:[['narration','工房の戸口には、看板を外した跡が残っている。']]});
    if(events.kiln?.status==='completed'&&worldAge(s,'kiln')>=23&&here==='east')out.push({id:'kiln-return',name:'窯焚きの後日談',portrait:'apprentice',story:[['narration','若い陶工が、イースの工房を訪ねてきている。'],['narration','棚には、一客だけ値札のない器が置かれている。'],['apprentice','売るつもりだったんだけどね。'],['apprentice','……次のを売るよ。']]});
    if(events.wheel?.status==='missed'&&worldAge(s,'wheel')>MERCHANT_STOPS.at(-1).to&&here==='south')out.push({id:'wheel-aftermath',name:'荷車のあと',portrait:'',story:[['narration','休憩場所には荷車の跡と、道脇へ寄せられた車輪の破片が残っている。']]});
    return out;
  }
  function scenarioStages(s){
    syncWorld(s);const age=worldAge(s,'turnip'),kilnAge=worldAge(s,'kiln'),wheelAge=worldAge(s,'wheel'),events=s.standaloneEvents.events;
    return {turnip:events.turnip.status==='completed'&&age>=18?'second':events.turnip.status,kiln:kilnAge<20?'open':kilnAge<21?'closed':kilnAge<22?'fired':kilnAge<23?'cooling':'returned',wheel:wheelAge<10?'in_transit':wheelAge<18?'astaris':wheelAge<=24?'south_full':wheelAge<=36?'south_late':'departed'};
  }
  function snapshot(s) {const saved=clone(s);saved.rollback=null;saved.battle=null;saved.journey=null;saved.result=null;return saved;}
  const PARTY_LIMIT=12,BATTLE_LIMIT=5;
  const battleIds=s=>s.battleSelected??s.selected;
  function select(s,ids) {
    if(s.phase!=='town'||s.location!=='astaris'||!Array.isArray(ids)||ids.length<1||ids.length>PARTY_LIMIT||new Set(ids).size!==ids.length||ids.some(id=>!template(id)||!s.characters[id]))return false;
    if(s.battleSelected!==undefined||ids.length>BATTLE_LIMIT){const kept=battleIds(s).filter(id=>ids.includes(id));s.battleSelected=[...kept,...ids.filter(id=>!kept.includes(id))].slice(0,BATTLE_LIMIT);}
    s.selected=[...ids];invalidateInventory(s);note(s,'ギルドで無償編成。キャラ別の装備は保持。');return true;
  }
  function accept(s,id,ownerId) {
    if(s.phase!=='town'||s.activeQuest||!hasPorter(s))return false;
    const quest=board(s).find(q=>q.id===id);if(!quest)return false;
    if(!s.selected.includes(ownerId)||template(ownerId)?.job!=='porter')return false;
    if(!I.canReceive(s.characters[ownerId].inventory,Cargo.key(s.sequence+1),1,inventoryCapacity(s,ownerId)))return false;
    s.rollback=snapshot(s);s.sequence++;s.activeQuest={...quest,token:s.sequence};
    if(s.activeQuest.eventId==='wheel')for(const key of ['meeting','merchantAtStop','merchantCurrentStop','merchantTraveling','merchantCanWait','merchantWaitHours','merchantWindow','merchantDeparted'])delete s.activeQuest[key];
    if(quest.scenario){const event=s.standaloneEvents.events[quest.eventId];if(!event||event.status!=='available')return false;event.status='accepted';s.activeQuest.eventEpoch=s.standaloneEvents.epoch;}
    Cargo.issue(s,ownerId);invalidateInventory(s);note(s,quest.name+'を受注。'+template(ownerId).name+'が「荷物」を受け取りました。');return true;
  }
  function depart(s,destination,formation='convoy') {
    if(s.phase!=='town'||!destinations(s).some(p=>p.id===destination)||!['convoy','flank'].includes(formation))return false;
    if(inventoryOverflow(s).length)return false;
    if(s.selected.some(id=>template(id).job==='porter'&&s.characters[id].hp<=0))return false;
    if(!s.activeQuest){s.rollback=snapshot(s);s.sequence++;}
    const j=J.create();j.phase='road';j.selected=[...s.selected];j.formation=formation;j.potions=inventoryTotals(s).potion;j.kit='campaign';
    j.job=s.activeQuest?clone(s.activeQuest):{name:'未受注の移動',deadline:100000000,reward:0};
    j.origin=s.location;j.destination=destination;j.token=s.sequence;j.questless=!s.activeQuest;j.history=[];
    s.journey=j;s.battle=null;s.result=null;s.phase='road';note(s,`${getPlace(destination).name}へ出発${s.activeQuest?'':'（未受注：配達報酬なし）'}。`);return true;
  }
  function battleCharacter(c,u) {
    const copy=clone(c);for(const slot of Object.keys(u.thrownWeapons||{}))copy[S.storage(slot)]='empty-'+slot;return copy;
  }
  function applyEnemyLoadouts(b){
    let enemyPotions=Number.isSafeInteger(b.potions?.enemy)?b.potions.enemy:0;
    for(const u of b.units.filter(u=>u.side==='enemy')){
      const loadout=enemyLoadout[u.job],inventory=Object.fromEntries(Object.keys(loadout.inventory).map(id=>[id,0]));
      if(Object.hasOwn(inventory,'potion')&&enemyPotions>0){inventory.potion=Math.min(1,enemyPotions);enemyPotions-=inventory.potion;}
      applyEnemyEquipment(u,inventory);
    }
    if(enemyPotions>0){for(const u of b.units.filter(u=>u.side==='enemy'))if(Object.hasOwn(u.inventory,'potion')&&enemyPotions>0){const add=Math.min(enemyPotions,99-u.inventory.potion);u.inventory.potion+=add;enemyPotions-=add;}}
    if(b.potions)b.potions.enemy=enemyPotions;
  }
  function applyEquipment(s,b,replacement) {
    b.skillCooldownVersion=1;
    b.weightRevision=1;b.damageRevision=1;b.enemyEquipmentRevision=1;
    const loads=weightLoads(s),active=new Set(b.units.filter(u=>u.side==='ally').map(u=>u.id));
    b.partyAliveInitial=s.selected.filter(id=>s.characters[id].hp>0).length;
    b.initialDownWeight=s.selected.filter(id=>s.characters[id].hp<=0).reduce((n,id)=>n+(carriedWeight(s,id).total??0),0);
    b.reserveDownWeight=s.selected.filter(id=>!active.has(id)&&s.characters[id].hp<=0).reduce((n,id)=>n+(carriedWeight(s,id).total??0),0);
    for(const u of b.units.filter(u=>u.side==='ally')) {
      const c=s.characters[u.id];if(!c)continue;
      const g=replacement?.characterId===u.id?{...getGear(replacement.gearId),targetSlot:replacement.slot}:null,st=stats(c,g);
      const load=loads[u.id],overburdened=c.hp>0&&!!load&&load.total>st.str;
      u.max=st.max;u.maxMp=st.maxMp;u.hp=Math.min(st.max,c.hp);u.mp=Math.min(st.maxMp,c.mp);
      u.atk=st.atk;u.atkFire=st.atkFire;u.atkWater=st.atkWater;u.atkEarth=st.atkEarth;u.def=st.def;u.defFire=st.defFire;u.defWater=st.defWater;u.defEarth=st.defEarth;u.reach=st.reach;u.agi=st.speed;u.next=100/u.agi;u.equippedSkill=st.skill;
      u.attackWeapons=st.attackWeapons;u.attackBonus=st.attackBonus;u.activeSkills=st.activeSkills;u.skillSources=st.skillSources;u.effects=st.effects;u.canInvade=u.job!=='porter'&&st.effects.includes('invasion');
      u.weapon=template(u.id).job==='porter'?undefined:st.weaponType;
      u.race=c.race;u.str=st.str;u.int=st.int;u.equipment=st.equipment;u.carriedWeight=load?.own.total??0;u.weightLimit=st.str;u.fallenWeightShare=load?.fallenShare??0;u.overburdened=overburdened;
      u.element=st.element;
      u.baseAgi=st.speed;u.startedAlive=u.hp>0;if(overburdened){u.agi*=0.5;u.next=100/u.agi;}
    }
    applyEnemyLoadouts(b);
  }
  function applyEnemyEquipment(u,inventory=null){
    const loadout=enemyLoadout[u.job],weapon=getGear(loadout.weapon);
    const shield=loadout.shield?getGear(loadout.shield):null,gearList=[weapon,...(shield?[shield]:[])];
    u.equipment={rightHand:weapon.id,...(shield?{leftHand:shield.id}:{})};u.inventory=inventory||clone(loadout.inventory);u.element=elements[u.job]||'none';
    u.weapon=weapon.type;u.atk=weapon.atk||0;u.atkFire=weapon.atkFire||0;u.atkWater=weapon.atkWater||0;u.atkEarth=weapon.atkEarth||0;
    u.def=gearList.reduce((n,g)=>n+(g.def||0),0);u.defFire=gearList.reduce((n,g)=>n+(g.defFire||0),0);u.defWater=gearList.reduce((n,g)=>n+(g.defWater||0),0);u.defEarth=gearList.reduce((n,g)=>n+(g.defEarth||0),0);u.reach=weapon.reach||1;
    u.attackWeapons=[{slot:'rightHand',itemId:weapon.id,name:weapon.name,atk:u.atk,atkFire:u.atkFire,atkWater:u.atkWater,atkEarth:u.atkEarth,reach:u.reach,skill:null}];
    if(u.job==='scout')u.skillSources=enemySkillSources(u);
  }
  function enemySkillSources(u) {
    if(u.job!=='scout')return undefined;
    const g=getGear(bases.scout.weapon);
    return [{id:'scout',slot:'rightHand',itemId:g.id,grantSlot:1,classification:'active',level:g.skillLevel??1}];
  }
  function normalizedSkillSources(sources) {
    if(!Array.isArray(sources))return sources;
    const ordinals=new Map();
    return sources.map(source=>{
      const key=JSON.stringify([source.slot,source.itemId]),ordinal=(ordinals.get(key)||0)+1;ordinals.set(key,ordinal);
      // Only fill fields absent in old saves. Existing values still undergo exact validation.
      return {...source,...(source.grantSlot===undefined?{grantSlot:ordinal}:{}),...(['scout','archer'].includes(source.id)?{level:source.level??1}:{})};
    });
  }
  const separateHandCopies=(g,a,b)=>g&&!['fist','empty'].includes(g.type)&&g.hands!==2&&['rightHand','leftHand'].includes(a)&&['rightHand','leftHand'].includes(b)&&a!==b&&S.allowed(g).includes(a)&&S.allowed(g).includes(b);
  function deploymentPreset(ids,kind) {
    const preset=B.create({ally:ids,enemy:[],formation:kind,deployment:true}),used=new Set();
    // The legacy flank factory moves the scout to 14 after assigning other
    // members. New combinations can contain another member already at 14.
    // Preserve the formation's scout anchor and place only collisions nearby.
    const allies=[...preset.units].sort((a,b)=>Number(kind==='flank'&&b.job==='scout')-Number(kind==='flank'&&a.job==='scout'));
    for(const u of allies){
      if(used.has(u.pos)){
        const origin=u.pos,distance=p=>Math.abs(p%10-origin%10)+Math.abs(Math.floor(p/10)-Math.floor(origin/10));
        u.pos=Array.from({length:50},(_,p)=>p).filter(p=>B.boardOf(p)==='ally'&&!used.has(p)).sort((a,b)=>distance(a)-distance(b)||a-b)[0];
      }
      used.add(u.pos);
    }
    return preset;
  }
  function travel(s,route,random=Math.random) {
    if(inventoryOverflow(s).length)return false;
    if(s.phase!=='road'||!s.journey||!['short','safe'].includes(route)||typeof random!=='function')return false;
    const j=s.journey,encounterStage=j.returning?0:j.stage,count=route==='short'?(encounterStage===0?3:4):(encounterStage===0?2:3);
    if(j.returning&&route!==j.outboundRoute)return false;
    let enemies;try{enemies=J.randomEnemies(count,()=>{const n=random();if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>=1)throw new Error('Random value out of range');return n;});}catch(e){return false;}
    if(!J.travel(s.journey,route))return false;
    if(j.stage===0)j.outboundRoute=route;
    s.hours+=route==='short'?2:4;tickWorld(s,route==='short'?2:4);
    const ids=battleIds(s),b=B.create({ally:ids,enemy:enemies,formation:j.formation,formationVersion:2,
      potions:inventoryTotals(s,ids).potion,ethers:inventoryTotals(s,ids).ether,enemyPotions:encounterStage===0?0:1,deployment:true});
    b.itemInventories=Object.fromEntries(ids.map(id=>[id,Object.fromEntries(items.map(item=>[item.id,I.count(s.characters[id].inventory,item.id)]))]));
    const preset=deploymentPreset(ids,j.formation);for(const u of b.units.filter(u=>u.side==='ally'))u.pos=preset.units.find(p=>p.id===u.id).pos;
    applyEquipment(s,b);b.campaignToken=j.token;b.campaignStage=j.stage;
    b.deploymentInitial=b.units.filter(u=>u.side==='ally').map(u=>({id:u.id,pos:u.pos}));
    s.battle=b;j.phase='deployment';s.phase='deployment';note(s,`${j.stage+1}区間目：${route==='short'?'近道':'迂回'}で遭遇。`);return true;
  }
  function deploy(s,id,pos) {return s.phase==='deployment'&&!!s.battle&&B.deploy(s.battle,id,pos);}
  // Membership changes are preparation-only. Build the candidate first; rejected drops
  // must not change inventories, formation, history, or the saved party selection.
  function deployment_assign(s,id,pos) {
    if(s.phase!=='deployment'||!s.battle?.deploying||!s.selected.includes(id))return false;
    const b=s.battle,current=b.units.filter(u=>u.side==='ally'),old=current.find(u=>u.id===id);
    if(pos!==null&&(!Number.isInteger(pos)||pos<0||pos>=50||B.boardOf(pos)!=='ally'))return false;
    if(old&&pos!==null)return B.deploy(b,id,pos);
    if(!old&&(pos===null||s.characters[id].hp<=0))return false;
    const occupant=pos===null?null:b.units.find(u=>u.hp>0&&u.pos===pos);
    if(occupant&&occupant.side!=='ally')return false;
    if(!old&&!occupant&&current.length>=BATTLE_LIMIT)return false;
    const ids=current.filter(u=>u.id!==id&&u.id!==occupant?.id).map(u=>u.id);
    let added=null;
    if(!old){
      const candidate=B.create({ally:[id],enemy:[],deployment:true});applyEquipment(s,candidate);
      added=candidate.units[0];added.pos=pos;ids.push(id);
    }
    const preset=deploymentPreset(ids,s.journey.formation);
    b.units=[...current.filter(u=>ids.includes(u.id)),...(added?[added]:[]),...b.units.filter(u=>u.side==='enemy')];
    // The tie breaker includes the member index. A newly created singleton has
    // index zero, so canonicalize every participant after membership edits.
    for(const u of b.units.filter(u=>u.side==='ally'))u.tie=preset.units.find(p=>p.id===u.id).tie;
    s.battleSelected=ids;
    b.itemInventories=Object.fromEntries(ids.map(uid=>[uid,b.itemInventories[uid]??Object.fromEntries(items.map(item=>[item.id,I.count(s.characters[uid].inventory,item.id)]))]));
    b.potions.ally=ids.reduce((n,uid)=>n+b.itemInventories[uid].potion,0);
    b.ethers=ids.reduce((n,uid)=>n+b.itemInventories[uid].ether,0);
    b.deploymentInitial=preset.units.map(u=>({id:u.id,pos:u.pos}));
    return true;
  }
  function chooseFormation(s,kind) {
    if(s.phase!=='deployment'||!s.battle||!['convoy','flank'].includes(kind))return false;
    const preset=deploymentPreset(battleIds(s),kind);
    s.battle.formationVersion=2;s.battle.formationKind=kind;s.journey.formation=kind;
    s.battle.deploymentInitial=preset.units.map(u=>({id:u.id,pos:u.pos}));
    return true;
  }
  function deployment_reset(s) {
    if(s.phase!=='deployment'||!s.battle)return false;
    for(const p of s.battle.deploymentInitial)s.battle.units.find(u=>u.id===p.id).pos=p.pos;return true;
  }
  function begin(s) {if(s.phase!=='deployment'||!s.battle||!s.battle.units.some(u=>u.side==='ally'&&u.hp>0)||!validate(s).ok||!B.begin(s.battle))return false;s.phase='battle';s.journey.phase='battle';return true;}
  function act(s,kind,target) {
    if(s.phase!=='battle'||!s.battle)return false;
    const accepted=B.act(s.battle,kind,target);
    if(accepted&&s.battle.result&&!s.battle.failure&&s.battle.units.filter(u=>u.side==='enemy').every(u=>u.hp<=0))s.battle.result='勝利！ 街道を切り抜けた。';
    return accepted;
  }
  function gainXp(s,amount) {
    // Legacy team xp/level fields are retained only for save compatibility.
    // Rewards apply exactly once to the current travelling characters.
    for(const id of s.selected){const c=s.characters[id],old=c.level;c.xp+=amount;c.level=1+Math.floor(c.xp/100);c.statPoints+=(c.level-old)*2;c.skillPoints+=c.level-old;}
  }
  function rollbackFailure(s,reason) {
    const failedTrip={origin:s.journey.origin,destination:s.journey.destination,hours:s.journey.hours};
    const failedEvent=s.activeQuest?.eventId,elapsedWorld=s.worldTime??s.hours,events=clone(s.standaloneEvents||freshWorldEvents(s.hours));
    const old=clone(s.rollback);for(const key of Object.keys(s))delete s[key];Object.assign(s,old);
    s.worldTime=elapsedWorld;s.standaloneEvents=events;if(failedEvent&&s.standaloneEvents.events[failedEvent]?.status==='accepted')s.standaloneEvents.events[failedEvent].status='available';syncWorld(s);
    invalidateInventory(s);
    s.phase='result';s.result={outcome:'failed',reason,restored:true,trip:failedTrip,gold:0,xp:0};
    note(s,reason+' 受注／出発前の状態を復元しました。');return true;
  }
  function retreat(s) {
    const b=s.battle,j=s.journey;
    if(s.phase!=='battle'||!b||b.result||!j||!s.rollback||b.campaignToken!==j.token||b.campaignStage!==j.stage)return false;
    return rollbackFailure(s,'戦闘から撤退しました。');
  }
  function finishBattle(s) {
    const b=s.battle,j=s.journey;
    if(s.phase!=='battle'||!b?.result||!j||b.campaignToken!==j.token||b.campaignStage!==j.stage)return false;
    const allies=b.units.filter(u=>u.side==='ally'),failed=allies.some(u=>u.job==='porter'&&u.hp<=0)||allies.every(u=>u.hp<=0)||!!b.failure;
    if(failed)return rollbackFailure(s,'ポーター戦闘不能または護送隊敗北。');
    if(b.units.some(u=>u.side==='enemy'&&u.hp>0))return false;
    if(!J.finishBattle(j,b))return false;
    // Journey recovery and EXP already apply to all travelling members. Reserve
    // characters retain their own HP/MP and items; only actual participants settle.
    if(s.battleSelected!==undefined)j.party=s.selected.map(id=>{
      const unit=allies.find(u=>u.id===id);if(unit)return clone(unit);
      const t=template(id),c=s.characters[id],st=stats(c);
      return {...t,hp:c.hp,mp:c.mp,max:st.max,maxMp:st.maxMp};
    });
    for(const u of allies){s.characters[u.id].hp=u.hp;s.characters[u.id].mp=u.mp;}
    for(const u of allies)for(const item of items){const count=b.itemInventories[u.id][item.id];if(count)s.characters[u.id].inventory[item.id]=count;else delete s.characters[u.id].inventory[item.id];}
    s.hours+=1;tickWorld(s,1);
    const reward={xp:20,gold:8};gainXp(s,reward.xp);s.gold+=reward.gold;
    note(s,`戦闘勝利：戦闘EXP＋${reward.xp}・戦利品${reward.gold}G（配達報酬とは別）。`);
    s.battle=null;s.phase=j.phase==='delivery'?'arrival':j.phase;return true;
  }
  function rest(s) {
    if(inventoryOverflow(s).length)return false;
    if(s.phase!=='camp'||!s.journey||!J.rest(s.journey))return false;
    s.hours+=2;tickWorld(s,2);
    for(const u of s.journey.party){const c=s.characters[u.id];c.hp=u.hp>0?u.hp:0;c.mp=u.mp;}
    note(s,'野営で休息（2時間・HP＋60／MP＋2）。');return true;
  }
  function waitForEvent(s,expected=null){
    const m=recipientMeeting(s);if(!m?.canWait)return false;
    if(expected!==null&&(!expected||typeof expected!=='object'||Object.keys(m.waitExpected).some(k=>expected[k]!==m.waitExpected[k])))return false;
    const hours=m.waitHours;s.hours+=hours;tickWorld(s,hours);
    note(s,`行商人の到着予定まで${hours}時間待ちました。`);return true;
  }
  function onward(s) {if(s.phase!=='camp'||inventoryOverflow(s).length||!J.onward(s.journey))return false;s.phase='road';return true;}
  function canTurnBack(s) {
    const j=s.journey;
    return !!j&&['camp','road'].includes(s.phase)&&j.stage===1&&!j.returning&&['short','safe'].includes(j.outboundRoute||j.route)&&!inventoryOverflow(s).length;
  }
  function turnBack(s,random=Math.random) {
    if(!canTurnBack(s))return false;
    const j=s.journey,old=clone(j),phase=s.phase;
    j.outboundRoute=j.outboundRoute||j.route;j.outboundDestination=j.destination;j.destination=j.origin;j.returning=true;j.phase='road';s.phase='road';
    if(!travel(s,j.outboundRoute,random)){s.journey=old;s.phase=phase;return false;}
    note(s,getPlace(j.origin).name+'へ、通った道を引き返します。');return true;
  }
  function forecast(s,choice) {
    if(!s.journey||!['road','camp'].includes(s.phase)||!['short','safe','rest','turnBack'].includes(choice))return null;
    if(choice==='turnBack'&&!canTurnBack(s))return null;
    const f=choice==='turnBack'?{hours:s.journey.hours+((s.journey.outboundRoute||s.journey.route)==='safe'?4:2)+1}:J.forecast(s.journey,choice),q=s.activeQuest;
    const arrivalLocation=choice==='turnBack'?s.journey.origin:s.journey.destination;
    if(q?.eventId){
      const age=s.worldTime-(q.eventEpoch??s.standaloneEvents.epoch),delta=Math.max(0,f.hours-s.journey.hours),predicted=age+delta,late=predicted>q.deadline;
      const meeting=recipientMeeting(s,q,{age:predicted,location:arrivalLocation,phase:'town'});
      const handoffStop=meeting?meeting.currentStop:q.to;
      const handoffAvailable=meeting?meeting.handoffAvailable:arrivalLocation===q.to&&!late&&Cargo.aboard(s);
      const reward=handoffAvailable?(q.eventId==='wheel'&&late?q.lateReward:q.reward):0;
      const immediate={hours:predicted,worldTime:s.worldTime+delta,handoffAvailable,reward,late,meeting};
      let afterWait=null;
      if(meeting?.canWait){
        const later=recipientMeeting(s,q,{age:meeting.waitUntilAge,location:arrivalLocation,phase:'town'}),laterLate=later.age>q.deadline;
        afterWait={hours:later.age,worldTime:later.worldTime,handoffAvailable:later.handoffAvailable,reward:later.handoffAvailable?(laterLate?q.lateReward:q.reward):0,late:laterLate,meeting:later};
      }
      return {...f,hours:predicted,late,over:Math.max(0,predicted-q.deadline),remaining:Math.max(0,q.deadline-predicted),deadline:q.deadline,reward,scenario:true,willFail:q.eventId==='wheel'?predicted>q.lateDeadline:arrivalLocation===q.to&&late,handoffStop,handoffPhase:meeting?(meeting.state==='in_transit'?'before_arrival':meeting.state):null,handoffAvailable,arrivalLocation,meeting,immediate,afterWait,waitHours:meeting?.canWait?meeting.waitHours:0,questless:false};
    }
    const hours=f.hours+(q?.elapsedHours||0),late=!!q&&hours>q.deadline;
    return {...f,hours,late,over:q?Math.max(0,hours-q.deadline):0,reward:q?Math.floor(q.reward*(late?.65:1)):0,questless:!q};
  }
  function arrive(s) {
    const j=s.journey;if(s.phase!=='arrival'||!j||j.stage!==2)return false;
    s.location=j.destination;
    if(s.activeQuest){
      s.activeQuest.elapsedHours=(s.activeQuest.elapsedHours||0)+j.hours;
      if(s.activeQuest.eventId==='wheel')refreshWheelQuest(s,s.activeQuest);
      s.journey=null;s.battle=null;s.result=null;s.phase='town';
      note(s,getPlace(s.location).name+'に到着。依頼は未完了です。');return true;
    }
    s.boardRound++;s.phase='result';s.result={outcome:'travel',gold:0,xp:0,hours:j.hours,location:s.location,quest:null,restored:false};
    note(s,'未受注の移動で到着。配達報酬なし。');s.rollback=null;s.battle=null;j.phase='result';return true;
  }
  function completeQuest(s,expected=null){
    const q=s.activeQuest;
    if(s.phase!=='town'||!q)return false;
    const meeting=recipientMeeting(s,q),overdueWheel=!!meeting?.canSettleFailure;
    // A failed contract restores its snapshot; it is not a cargo handoff.
    // Optional confirmation context rejects stale UI actions without changing legacy callers.
    if(expected!==null&&(!overdueWheel||!record(expected)||expected.questToken!==q.token||expected.location!==s.location||expected.worldTime!==s.worldTime))return false;
    if(!overdueWheel&&!Cargo.aboard(s))return false;
    const age=meeting?meeting.age:q.eventId?worldAge(s,q.eventId):null;
    const handoffLocation=meeting?meeting.currentStop:q.to;
    if(s.location!==handoffLocation&&!overdueWheel)return false;
    if(q.eventId==='wheel'&&age<10)return false;
    const hours=q.elapsedHours||0,late=q.eventId?age>q.deadline:hours>q.deadline;
    const scenarioFailure=!!q.eventId&&(q.eventId==='wheel'?age>q.lateDeadline:late);
    if(scenarioFailure){
      const currentWorld=s.worldTime,events=clone(s.standaloneEvents),old=clone(s.rollback);
      for(const key of Object.keys(s))delete s[key];Object.assign(s,old);s.worldTime=currentWorld;s.standaloneEvents=events;s.standaloneEvents.events[q.eventId].status='failed';syncWorld(s);
      s.phase='result';s.result={outcome:'failed',reason:SCENARIO_DEADLINE_REASON,gold:0,xp:0,hours,worldTime:currentWorld,location:s.location,quest:q.name,scenario:q.eventId,restored:true};note(s,`${q.name}は期限を過ぎ、荷物と受注前の状態を戻しました。報酬はありません。`);s.activeQuest=null;s.rollback=null;s.journey=null;s.battle=null;return true;
    }
    const amount=q.eventId==='wheel'&&late?q.lateReward:q.eventId?q.reward:Math.floor(q.reward*(late?.65:1));
    const rewardType=q.rewardType==='experience'?'experience':'money',gold=rewardType==='money'?amount:0;
    const rp=q.rewardRevision===1?(late?Math.min(60,q.xp):q.xp):0;
    const xp=rewardType==='experience'?amount:q.rewardRevision===1?0:late?60:q.xp;
    if(!Cargo.consume(s))return false;
    invalidateInventory(s);s.gold+=gold;if(xp)gainXp(s,xp);if(rp)s.partyRP=(s.partyRP||0)+rp;s.completed++;s.boardRound++;
    note(s,'「荷物」を渡しました。'+q.cargo+'を引き渡しました。');
    note(s,`配達完了：${gold}G・RP＋${rp}${xp?'・各メンバーEXP＋'+xp:''}${late?'（基本報酬）':'（希望条件達成）'}。`);
    if(q.eventId){s.standaloneEvents.events[q.eventId].status=scenarioFailure?'failed':'completed';}
    const resultStory=q.eventId?(q.eventId==='wheel'&&late?q.lateStory:q.successStory):null;
    s.phase='result';s.result={outcome:late?'late':'success',gold,xp,rp,rewardType,partyRP:s.partyRP||0,hours,worldTime:s.worldTime,location:s.location,quest:q.name,scenario:q.eventId||null,portrait:q.portrait||null,cast:q.cast||[],story:resultStory||null,restored:false};
    s.activeQuest=null;s.rollback=null;s.journey=null;s.battle=null;return true;
  }
  function acknowledge(s) {
    if(s.phase!=='result')return false;
    s.phase='town';s.journey=null;s.battle=null;s.result=null;s.activeQuest=null;s.rollback=null;return true;
  }
  function eligibility(s,charId,gearId) {
    const c=s.characters[charId],g=getGear(gearId);if(!c||!g)return {ok:false,reason:'キャラまたは装備が不明です'};
    const st=stats(c),t=template(charId),m=materials[g.material];
    if(c.race==='elf'&&m.metal&&!['silver'].includes(g.material))return {ok:false,reason:'エルフは金・銀以外の金属装備不可'};
    if(c.race==='dwarf'&&['sword','dagger','greatsword'].includes(g.type))return {ok:false,reason:'ドワーフは刀剣類を装備不可（短剣も含む仮分類）'};
    if(g.raceOnly&&g.raceOnly!==c.race||g.excludedRaces?.includes(c.race))return {ok:false,reason:'種族の装備条件を満たしていません'};
    // Legacy characters had no sex field. Keep their existing equipment usable;
    // new roster entries provide a stable explicit sex rather than guessing it.
    const sex=c.sex??t.sex;
    if(g.sexOnly&&sex!==undefined&&g.sexOnly!==sex)return {ok:false,reason:'性別の装備条件を満たしていません'};
    for(const key of ['str','int','agi'])if(st[key]<g[key])return {ok:false,reason:`必要${key.toUpperCase()} ${g[key]}／現在${st[key]}`};
    if(g.jobOnly&&g.jobOnly!==t.job)return {ok:false,reason:`${{porter:'ポーター',guard:'戦士',scout:'スカウト',archer:'スカウト',mage:'魔法使い'}[g.jobOnly]||g.jobOnly}専用です`};
    if(g.virtualDefault)return {ok:false,reason:'装備なし時の既定性能です。所持品として装備できません'};
    if(g.starterOnly&&g.id!==bases[template(charId).job].weapon)return {ok:false,reason:'この職の初期装備ではありません'};
    return {ok:true,reason:t.job==='porter'?'C01保留：手道具交換後も攻撃・攻撃スキルは使えません':null};
  }
  function shop(s) {
    if(s.phase!=='town')return [];
    const kind=s.location==='east'?'weapon':s.location==='west'?'armor':s.location==='north'?'accessory':null;
    return kind?gear.filter(g=>(g.slot===kind||kind==='armor'&&['head','lowerBody','feet'].includes(g.slot)||kind==='accessory'&&['accessory1','accessory2'].includes(g.slot)||kind==='weapon'&&g.slot==='leftHand')&&!g.starterOnly&&g.purchasable!==false&&g.type!=='fist').map(displayGear):s.location==='south'?clone(items):[];
  }
  function quote(s,charId,gearId,slot) {
    const c=s.characters[charId],g=getGear(gearId);if(!c||!g)return null;
    slot=S.canonical(slot||g.slot);if(!Object.hasOwn(S.slots,slot)||!S.allowed(g).includes(slot))return null;
    const eq=equipment(c),old=getGear(eq[slot]),cost=g.price,eligible=eligibility(s,charId,gearId);
    if(old.removable===false&&old.id!==g.id){eligible.ok=false;eligible.reason='この装備は外せません';}
    if(g.hands===2&&!eq.leftHand.startsWith('empty-')){eligible.ok=false;eligible.reason='両手装備には左手の空きが必要です。先に左手装備を外してください';}
    if(slot==='leftHand'&&getGear(eq.rightHand)?.hands===2){eligible.ok=false;eligible.reason='右手の両手装備が左手も使用中です。先に右手を交換してください';}
    if(!g.id.startsWith('empty-')&&Object.entries(eq).some(([k,id])=>k!==slot&&S.identity(id)===S.identity(g.id)&&!separateHandCopies(g,k,slot))){eligible.ok=false;eligible.reason='同じ装備は二つの枠に装備できません';}
    return {characterId:charId,gearId,slot,oldGearId:old.id,price:g.price,tradeIn:0,cost,retained:old.type!=='empty',affordable:s.gold>=cost,
      eligible:eligible.ok,reason:eligible.reason,same:old.id===g.id,available:shop(s).some(item=>item.id===gearId)};
  }
  function buyGear(s,charId,gearId,slot) {
    if(s.phase!=='town'||!s.selected.includes(charId))return false;
    const q=quote(s,charId,gearId,slot);if(!q||!q.available||!q.eligible||!q.affordable||q.same)return false;
    return commitInventory(s,draft=>{
      const c=draft.characters[charId],g=getGear(gearId);
      if(q.retained){const bag=I.add(c.inventory,q.oldGearId,1);if(!bag)return false;c.inventory=bag;}
      draft.gold-=q.cost;c[S.storage(q.slot)]=gearId;syncCharacter(draft,charId);
      note(draft,`${template(charId).name}：${g.name}を${q.cost}Gで購入・装備。${q.retained?'外した装備は本人のインベントリへ。':''}`);return true;
    });
  }
  function buyItem(s,id,count=1,ownerId,token) {
    const item=items.find(i=>i.id===id);
    if(s.phase!=='town'||s.location!=='south'||!item||!I.quantity(count)||!s.selected.includes(ownerId)||token!==inventoryToken(s)||inventoryTotals(s,Object.keys(s.characters))[id]+I.count(s.warehouse,id)+count>99||s.gold<item.price*count)return false;
    if(!I.canReceive(s.characters[ownerId].inventory,id,count,inventoryCapacity(s,ownerId)))return false;
    return commitInventory(s,draft=>{
      const bag=I.add(draft.characters[ownerId].inventory,id,count);if(!bag)return false;
      draft.characters[ownerId].inventory=bag;draft.gold-=item.price*count;
      note(draft,`${template(ownerId).name}が${item.name}を${count}個購入。`);return true;
    });
  }
  function innQuote(s) {
    return {price:INN_PRICE,available:s.phase==='town'&&s.location==='astaris',
      affordable:s.gold>=INN_PRICE,needsRecovery:s.selected.some(id=>{
        const c=s.characters[id],st=stats(c);return c.hp<st.max||c.mp<st.maxMp;
      })};
  }
  function inn(s) {
    const q=innQuote(s);
    if(!q.available||!q.affordable||!q.needsRecovery)return false;
    s.gold-=q.price;
    for(const id of s.selected){const c=s.characters[id],st=stats(c);c.hp=st.max;c.mp=st.maxMp;}
    note(s,`アスタリスの宿屋：${q.price}Gで編成中の全員のHP・MPを全回復。`);
    return true;
  }
  function syncCharacter(s,id) {
    const c=s.characters[id],st=stats(c);c.hp=Math.min(st.max,c.hp);c.mp=Math.min(st.maxMp,c.mp);
    if(s.journey){
      s.journey.potions=inventoryTotals(s).potion;
      const u=s.journey.party?.find(u=>u.id===id);
      if(u){u.hp=c.hp;u.mp=c.mp;u.max=st.max;u.maxMp=st.maxMp;}
    }
  }
  function commitInventory(s,change) {
    const draft=clone(s);if(!change(draft))return false;
    // Use the actual pretty-printed save representation, including whitespace.
    try{serialize(draft);}catch{return false;}
    // Validation finishes before either participant or any resource is changed.
    for(const [id,c] of Object.entries(draft.characters))Object.assign(s.characters[id],c);
    for(const [key,value] of Object.entries(draft))if(key!=='characters')s[key]=value;
    invalidateInventory(s);
    return true;
  }
  function inventoryQuote(s,ownerId,id,action,targetId=null,count=1,slot=null) {
    const owner=template(ownerId)&&s.characters[ownerId],item=items.find(i=>i.id===id),g=getGear(id),definition=item||g;
    const q={ownerId,itemId:id,action,targetId,count,slot,token:inventoryToken(s),ok:false,reason:'',name:definition?.name||id,ownerName:template(ownerId)?.name||ownerId,targetName:template(targetId)?.name||targetId,available:owner?I.count(owner.inventory,id):0};
    const fail=reason=>({...q,reason});
    if(Cargo.isKey(id)){
      if(action!=='transfer')return fail('クエストの荷物です。使用・売却・廃棄はできません。');
      if(!Cargo.validEntry(s,ownerId,id,count))return fail('荷物の所持者が変わりました。');
      if(!['town','camp','road','arrival'].includes(s.phase)||!s.selected.includes(ownerId)||!s.selected.includes(targetId))return fail('戦闘外で同行中のポーターに渡せます。');
      if(targetId===ownerId||template(targetId)?.job!=='porter')return fail('荷物を持てるのはポーターだけです。');
      if(!I.canReceive(s.characters[targetId].inventory,id,count,inventoryCapacity(s,targetId)))return fail('受取人のインベントリ枠が不足しています');
      return {...q,name:'荷物',ok:true};
    }
    if(!owner||!definition||g?.type==='empty')return fail('所持品が見つかりません');
    if(!['town','camp'].includes(s.phase)&&!(['road','arrival'].includes(s.phase)&&['transfer','transferEquipped','discard'].includes(action)))return fail('町・野営で操作できます');
    if(!s.selected.includes(ownerId))return fail('編成中の仲間の所持品を操作できます');
    if(!I.quantity(count))return fail('個数は1以上の整数にしてください');
    if(['unequip','transferEquipped'].includes(action)){
      if(count!==1||!Object.hasOwn(S.slots,slot)||equipment(owner)[slot]!==id)return fail('装備の状態が変わりました');
      if(g?.removable===false)return fail('この装備は外せません');
      if(slot==='leftHand'&&getGear(equipment(owner).rightHand)?.hands===2)return fail('右手の両手装備が使用中です');
    } else if(q.available<count)return fail('所持数が不足しています');
    if(action==='use'){
      if(!item)return fail('装備品です。「装備する」から装備枠を選択してください');
      if(count!==1)return fail('使用は1回につき1個です');
      const target=template(targetId)&&s.characters[targetId];
      if(!target||!s.selected.includes(targetId))return fail('編成中の回復対象を選んでください');
      if(target.hp<=0)return fail('戦闘不能の仲間には使用できません');
      const st=stats(target),max=item.resource==='hp'?st.max:st.maxMp;
      if(target[item.resource]>=max)return fail('全回復しています');
      q.resource=item.resource;q.before=target[item.resource];q.after=Math.min(max,q.before+item.amount);q.effect=q.after-q.before;
    } else if(action==='transfer'||action==='transferEquipped'){
      if(g?.transferable===false)return fail('この装備は受け渡しできません');
      if(targetId===ownerId)return fail('別の仲間を選んでください');
      if(!template(targetId)||!s.characters[targetId]||!s.selected.includes(targetId))return fail('編成中の受取人を選んでください');
      if(action==='transfer'&&!I.transfer(owner.inventory,s.characters[targetId].inventory,id,count))return fail('受け渡しできる個数を超えています');
      if(!I.canReceive(s.characters[targetId].inventory,id,count,inventoryCapacity(s,targetId)))return fail('受取人のインベントリ枠が不足しています');
    } else if(action==='equip'){
      if(!g||count!==1)return fail('装備品を1個選んでください');
      const eq=quote(s,ownerId,id,slot);
      if(!eq||!eq.eligible||eq.same)return fail(eq?.reason||'装備枠または装備条件を確認してください');
      q.slot=eq.slot;q.oldGearId=eq.oldGearId;q.retained=eq.retained;
    } else if(!['discard','unequip'].includes(action))return fail('操作を選んでください');
    if(action==='transferEquipped'){
      const draft=clone(s);draft.characters[ownerId][S.storage(slot)]=`empty-${slot}`;
      if(I.occupancy(owner.inventory,inventoryCapacity(draft,ownerId)).overflow.length)return fail('装備を外すと持ち主のインベントリ枠が不足します');
    }
    return {...q,ok:true};
  }
  function inventoryAction(s,ownerId,id,action,targetId,count,slot,token) {
    if(token!==inventoryToken(s))return false;
    const q=inventoryQuote(s,ownerId,id,action,targetId,count,slot);if(!q.ok)return false;
    return commitInventory(s,draft=>{
      const owner=draft.characters[ownerId],item=items.find(i=>i.id===id);
      if(action==='transferEquipped'){
        const bag=I.add(draft.characters[targetId].inventory,id,1);if(!bag)return false;
        owner[S.storage(slot)]=`empty-${slot}`;draft.characters[targetId].inventory=bag;
      } else if(action==='transfer'){
        const moved=I.transfer(owner.inventory,draft.characters[targetId].inventory,id,count);if(!moved)return false;
        owner.inventory=moved.source;draft.characters[targetId].inventory=moved.target;
        if(Cargo.isKey(id))draft.activeQuest.cargoOwnerId=targetId;
      } else if(action==='unequip'){
        owner.inventory=I.add(owner.inventory,id,1);if(!owner.inventory)return false;
        owner[S.storage(slot)]=`empty-${slot}`;
      } else {
        owner.inventory=I.remove(owner.inventory,id,count);if(!owner.inventory)return false;
        if(action==='use')draft.characters[targetId][item.resource]=q.after;
        if(action==='equip'){
          if(q.retained){owner.inventory=I.add(owner.inventory,q.oldGearId,1);if(!owner.inventory)return false;}
          owner[S.storage(q.slot)]=id;
        }
      }
      syncCharacter(draft,ownerId);if(targetId&&draft.characters[targetId])syncCharacter(draft,targetId);
      const text={use:`${q.targetName}に使用`,transfer:`${q.targetName}へ渡した`,transferEquipped:`装備を外して${q.targetName}へ渡した`,discard:'捨てた',equip:'装備した',unequip:'装備から外した'}[action];
      note(draft,`${q.ownerName}の${q.name} ${count}個：${text}。`);return true;
    });
  }
  function useItem(s,id,targetId,ownerId,token) {
    return inventoryAction(s,ownerId,id,'use',targetId,1,null,token);
  }
  function inventoryView(s,ownerId) {
    const owner=s.characters[ownerId];
    const capacity=I.occupancy(owner.inventory,inventoryCapacity(s,ownerId));
    const carried={...owner.inventory};for(const id of Object.values(equipment(owner)))if(getGear(id)?.type!=='empty')carried[id]=(carried[id]||0)+1;
    const weight=carriedWeight(s,ownerId),statsValue=stats(owner);
    return {ownerId,capacity,weight,weightLimit:statsValue.str,overburdened:weight.total!==null&&weight.total>statsValue.str,token:inventoryToken(s),entries:Object.entries(owner.inventory).map(([id,count])=>{
      const cargo=Cargo.definition(s,id);
      if(cargo)return {overCapacity:capacity.overflow.includes(id),sale:saleQuote(s,ownerId,id),id,name:'荷物',count,kind:'quest',definition:clone(cargo),useTargets:[],transferTargets:s.selected.filter(target=>target!==ownerId).map(target=>inventoryQuote(s,ownerId,id,'transfer',target)),discard:inventoryQuote(s,ownerId,id,'discard'),equipSlots:[]};
      const item=items.find(i=>i.id===id),g=getGear(id);
      return {overCapacity:capacity.overflow.includes(id),sale:saleQuote(s,ownerId,id),id,name:(item||g).name,count,kind:item?'consumable':'equipment',definition:item?clone(item):displayGear(g),
        useTargets:s.selected.map(target=>inventoryQuote(s,ownerId,id,'use',target)),
        transferTargets:s.selected.filter(target=>target!==ownerId).map(target=>inventoryQuote(s,ownerId,id,'transfer',target)),
        discard:inventoryQuote(s,ownerId,id,'discard'),
        equipSlots:g?S.allowed(g).map(slot=>inventoryQuote(s,ownerId,id,'equip',null,1,slot)):[]};
    })};
  }
  // R07: session-only state identity prevents stale allocation after load/new game.
  const allocationStates=new WeakMap();let allocationSerial=0;
  function allocationToken(s,id) {
    if(!allocationStates.has(s))allocationStates.set(s,++allocationSerial);
    const c=s.characters[id];if(!c)return '';
    return JSON.stringify([allocationStates.get(s),id,s.sequence,s.boardRound,s.phase,s.location,s.selected,c.xp,c.statPoints,c.allocations.str,c.allocations.int,c.allocations.agi]);
  }
  function allocateBatch(s,charId,delta,expectedToken) {
    const c=s.characters[charId],keys=['str','int','agi'];
    if(s.phase!=='town'||!c||!s.selected.includes(charId)||expectedToken!==allocationToken(s,charId)||!record(delta)||Object.keys(delta).length!==3||!keys.every(k=>Number.isSafeInteger(delta[k])&&delta[k]>=0))return false;
    const total=keys.reduce((n,k)=>n+delta[k],0);
    if(!Number.isSafeInteger(total)||total<1||total>c.statPoints)return false;
    const old=stats(c),next={...c,allocations:{...c.allocations},statPoints:c.statPoints-total};
    for(const key of keys)next.allocations[key]+=delta[key];
    const after=stats(next);next.hp+=after.max-old.max;next.mp+=after.maxMp-old.maxMp;
    s.characters[charId]=next;
    note(s,`${template(charId).name}：${keys.filter(k=>delta[k]).map(k=>`${k.toUpperCase()}＋${delta[k]}`).join(' / ')}（${total}点を確定、残り${next.statPoints}点）。`);
    return true;
  }
  function allocate(s,charId,key,count=1) {
    const c=s.characters[charId];
    if(s.phase!=='town'||!c||!s.selected.includes(charId)||!['str','int','agi'].includes(key)||!Number.isInteger(count)||count<1||count>c.statPoints)return false;
    const old=stats(c);c.allocations[key]+=count;c.statPoints-=count;const after=stats(c);c.hp+=after.max-old.max;c.mp+=after.maxMp-old.maxMp;
    note(s,`${template(charId).name}：${key.toUpperCase()}＋${count}（仮成長値）。`);return true;
  }
  function previewGear(s,charId,gearId,slot) {
    const q=quote(s,charId,gearId,slot);if(!q)return null;
    return {...q,ok:q.eligible,gear:displayGear(getGear(gearId)),current:displayGear(getGear(q.oldGearId)),afterGold:s.gold-q.cost,before:stats(s.characters[charId]),after:stats(s.characters[charId],{...getGear(gearId),targetSlot:q.slot}),skillName:stats(s.characters[charId],{...getGear(gearId),targetSlot:q.slot}).activeSkills.map(id=>skills[id]).join(' / '),effectDescription:getGear(gearId).note||'',
      warning:'試着は資金・装備・HP/MP・消耗品・EXP・旅に影響しません。数値は試作値です。'};
  }
  function trial(s,charId,gearId,slot) {
    const preview=previewGear(s,charId,gearId,slot);
    if(s.phase!=='town'||!s.selected.includes(charId)||!preview?.eligible||!preview.available)return null;
    const friends=[...new Set(['guard','archer','mage',...s.selected])].filter(id=>id!==charId&&s.selected.includes(id)).slice(0,2);
    const b=B.create({ally:[charId,...friends],enemy:['guard','archer','mage'],enemyPotions:0,potions:3,deployment:true,formationVersion:2,formation:'convoy'});
    const copy=clone(s);for(const id of [charId,...friends]){const st=stats(copy.characters[id]);copy.characters[id].hp=st.max;copy.characters[id].mp=st.maxMp;}
    applyEquipment(copy,b,{characterId:charId,gearId,slot:preview.slot});
    const hero=b.units.find(u=>u.id===charId);if(hero.activeSkills.includes(getGear(gearId).skill))hero.selectedSkill=getGear(gearId).skill;hero.hp=hero.max;hero.mp=hero.maxMp;hero.pos=24;hero.next=0;
    for(const [i,u] of b.units.filter(u=>u.side==='ally'&&u.id!==charId).entries()){u.pos=(hero.job==='porter'?[13,33]:[23,33])[i];u.hp=Math.max(1,u.max-60);u.next=1000000;}
    for(const [i,u] of b.units.filter(u=>u.side==='enemy').entries()){u.name=`木人${i+1}`;u.role='木人';u.hp=u.max=9999;u.pos=[25,15,35][i];u.next=1000000;u.atk=0;}
    for(const [i,u] of b.units.filter(u=>u.side==='ally'&&u.id!==charId).entries()){u.pos=(hero.job==='porter'?[13,33]:[14,34])[i];u.mp=Math.max(0,u.maxMp-3);}
    // R04: porter trials demonstrate the new basic condition, without changing campaign spawns.
    if(hero.job==='porter'){hero.pos=23;b.units.filter(u=>u.side==='ally'&&u.id!==charId).forEach((u,i)=>u.pos=[12,32][i]);}
    // Passive trials need a reachable dummy even for reach-1 non-invaders.
    let supportActorId=null;
    if(B.hasEffect(hero,'loneWolf'))b.units.filter(u=>u.side==='ally'&&u.id!==charId).forEach((u,i)=>u.pos=[12,32][i]);
    if(B.hasEffect(hero,'victoryBreath')){
      const dummy=b.units.find(u=>u.side==='enemy');
      b.units=b.units.filter(u=>u.side==='ally'||u===dummy);
      if(hero.job==='porter'){
        // Training only: porters retain their attack ban; a real ally finishes.
        const helper=b.units.find(u=>u.side==='ally'&&u.id!==charId&&u.atk>0);
        if(helper){hero.pos=23;helper.pos=24;helper.next=1;supportActorId=helper.id;}
      }
    }
    B.begin(b);for(const u of b.units.filter(u=>u.side==='enemy'))u.intent={kind:'guard',target:null,name:'静止',reason:'木人は行動しません',cells:[]};
    if(B.activeSkill(hero)==='pincer'){
      b.units.find(u=>u.side==='enemy').pos=23;
      b.units.filter(u=>u.side==='ally'&&u.id!==charId).forEach((u,i)=>u.pos=[13,33][i]);
    }
    if(B.activeSkill(hero)==='defenseLine'){
      const dummy=b.units.find(u=>u.side==='enemy'),friend=b.units.find(u=>u.side==='ally'&&u.id!==charId);
      dummy.pos=15;const overlap=b.units.find(u=>u.id!==dummy.id&&u.side==='enemy'&&u.pos===15);if(overlap)overlap.pos=25;
      dummy.atk=12;dummy.reach=1;dummy.next=1;dummy.intent={kind:'attack',target:friend.id,name:'試験打撃',reason:'防衛線の引受確認（12基礎ダメージ）',cells:[friend.pos]};
    }
    if(B.hasEffect(hero,'victoryBreath')){hero.mp=Math.max(0,hero.maxMp-2);for(const u of b.units.filter(u=>u.side==='enemy'))u.hp=1;}
    b.log=['木人試用：資金・装備・HP/MP・EXPに影響しない独立戦闘。'];
    const notice=B.hasEffect(hero,'loneWolf')?(hero.job==='porter'?'ポーターは攻撃禁止のため、孤軍の与ダメージ補正は発動しません。':'孤軍確認用：仲間から離れた初期位置で木人を攻撃できます。'):supportActorId?'一息の木人はHP1・1体。防御などの行動後に仲間が倒し、本人の勝利回復を確認。':B.activeSkill(hero)==='defenseLine'?'防衛線の木人は初回に基礎12の試験打撃。':B.hasEffect(hero,'victoryBreath')?'一息の木人はHP1。倒して勝利回復を確認。':B.activeSkill(hero)==='pincer'?'挟撃確認用：味方陣内の木人に仲間を隣接配置。':'木人は反撃しません。';
    const trialNotice=hero.job==='porter'&&B.hasEffect(hero,'victoryBreath')&&!supportActorId?'ポーターだけでは木人を倒せません。一息の勝利回復を確認するには、攻撃できる仲間を編成してください。':notice;
    b.log.push(trialNotice);
    return {battle:b,metadata:{characterId:charId,gearId,name:getGear(gearId).name,isolated:true,notice:trialNotice+'試着終了で元の状態へ戻ります。'},characterId:charId,gearId,preview,actions:0,lastAction:null,isolated:true,supportActorId};
  }
  function trialAct(t,kind,target) {
    if(!t?.isolated||t.actions>=100||!t.battle||t.battle.actor!==t.characterId)return false;
    const before=clone(t.battle.units),logAt=t.battle.log.length+(t.battle.logDropped||0);
    if(!B.act(t.battle,kind,target))return false;
    if(t.supportActorId&&t.battle.actor===t.supportActorId&&!t.battle.result){
      const dummy=t.battle.units.find(u=>u.side==='enemy'&&u.hp>0);
      if(dummy&&B.legal(t.battle,'attack',dummy.id))B.act(t.battle,'attack',dummy.id);
    }
    t.actions++;t.lastAction={kind,target,messages:t.battle.log.slice(Math.max(0,logAt-(t.battle.logDropped||0))),changes:t.battle.units.map(u=>({id:u.id,name:u.name,hp:u.hp-(before.find(v=>v.id===u.id)?.hp||0),mp:u.mp-(before.find(v=>v.id===u.id)?.mp||0)})).filter(d=>d.hp||d.mp)};
    return true;
  }
  function view(s) {
    syncWorld(s);
    // Older standalone deadline results omitted the reason. Present it without rewriting the save.
    const shown=clone(s),result=shown.result;
    if(result?.outcome==='failed'&&SCENARIO_BY_ID[result.scenario]&&!result.reason)result.reason=SCENARIO_DEADLINE_REASON;
    const ids=battleIds(s),deployed=s.battle?s.battle.units.filter(u=>u.side==='ally').map(u=>u.id):[...ids];
    return {...shown,partyRP:s.partyRP||0,canTurnBack:canTurnBack(s),returnHours:canTurnBack(s)?((s.journey.outboundRoute||s.journey.route)==='safe'?5:3):0,activeQuest:displayQuest(s.activeQuest,s),partyLimit:PARTY_LIMIT,battleLimit:BATTLE_LIMIT,battleSelected:[...ids],deploymentRoster:{deployed,reserves:s.selected.filter(id=>!deployed.includes(id)),remaining:BATTLE_LIMIT-deployed.length,minimum:1,canBegin:s.phase==='deployment'&&!!s.battle?.units.some(u=>u.side==='ally'&&u.hp>0)&&validate(s).ok},cargoAboard:Cargo.aboard(s),cargoCarriers:Cargo.carriers(s),inventory:inventoryTotals(s),inventoryTotals:inventoryTotals(s,Object.keys(s.characters)),inventoryToken:inventoryToken(s),saleAvailable:saleAvailable(s),inventoryByCharacter:Object.fromEntries(Object.keys(s.characters).map(id=>[id,inventoryView(s,id)])),inn:innQuote(s),town:s.location,towns:clone(locations),locations:clone(locations),routes:clone(routes),destinations:clone(destinations(s)),board:board(s),scenarioAftermath:scenarioAftermath(s),scenarioStages:scenarioStages(s),shop:shop(s),itemDefinitions:clone(items),provisional:[...provisional],
      slots:S.slots,skillNames:{...skills,invasion:'潜入'},skillDefinitions:clone(E.definitions),roster:rosterFor(s).map(t=>{const c=s.characters[t.id];const st=stats(c);return {...t,...clone(c),allocationToken:allocationToken(s,t.id),max:st.max,maxMp:st.maxMp,atk:st.atk,agi:st.speed,reach:st.reach,stats:st,equipmentDetails:Object.fromEntries(Object.entries(st.equipment).map(([slot,id])=>[slot,displayGear(slot==='leftHand'&&getGear(st.equipment.rightHand)?.hands===2?getGear(st.equipment.rightHand):effectiveGear(c,slot,id))])),equipmentSlots:Object.entries(st.equipment).map(([slot,id])=>({slot,label:S.slots[slot],id,name:slot==='leftHand'&&getGear(st.equipment.rightHand)?.hands===2?getGear(st.equipment.rightHand).name+'（両手装備で使用中）':effectiveGear(c,slot,id).name,occupiedBy:slot==='leftHand'&&getGear(st.equipment.rightHand)?.hands===2?'rightHand':null})),activeSkillNames:st.activeSkills.map(id=>skills[id]),weaponName:getGear(c.weapon).name,armorName:getGear(c.armor).name,accessoryNames:['accessory1','accessory2'].map(slot=>getGear(c[slot]||defaultAccessory(c,slot)).name),skillName:st.activeSkills.map(id=>skills[id]).join(' / '),effectNames:st.effects.map(id=>skills[id]||'侵入')};}),
      inventoryOverflow:inventoryOverflow(s),warehouseView:warehouseView(s),guildAvailable:s.phase==='town'&&s.location==='astaris',hasPorter:hasPorter(s)};
  }
  function validate(state) {
    try {validateState(state,0);return {ok:true,error:null};}catch(e){return {ok:false,error:e.message};}
  }
  function demand(test,message) {if(!test)throw new Error('セーブデータが不正です：'+message);}
  const integer=(v,min=0,max=100000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
  function safeTree(v,depth=0) {
    demand(depth<=35,'深すぎるデータ');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){demand(Number.isFinite(v)&&Math.abs(v)<=1e10,'数値範囲');return;}
    if(typeof v==='string'){demand(v.length<=4000,'文字列が長すぎます');return;}
    demand(typeof v==='object','JSON以外の値');
    if(Array.isArray(v)){demand(v.length<=2000,'配列が長すぎます');for(const item of v)safeTree(item,depth+1);return;}
    demand(record(v),'オブジェクト形式');demand(Object.keys(v).length<=100,'項目数');
    for(const key of Object.keys(v)){demand(!['__proto__','constructor','prototype'].includes(key),'禁止されたキー');if(v[key]!==undefined)safeTree(v[key],depth+1);}
  }
  function validSelection(ids) {return Array.isArray(ids)&&ids.length>0&&ids.length<=PARTY_LIMIT&&new Set(ids).size===ids.length&&ids.every(id=>!!template(id));}
  function validateState(s,depth,version=VERSION) {
    if(depth===0)safeTree(s);
    demand(record(s)&&s.version===version,'バージョン');
    demand(s.inventoryRevision===undefined||s.inventoryRevision===1,'未対応のインベントリ形式');
    if(s.warehouse!==undefined){
      demand(record(s.warehouse),'倉庫の形式');
      demand(Object.entries(s.warehouse).every(([id,count])=>{
        const g=getGear(id);
        return integer(count,1,1e10)&&(items.some(item=>item.id===id)||g&&g.type!=='empty'&&g.type!=='fist'&&!g.virtualDefault&&g.transferable!==false);
      }),'倉庫の品物または個数');
    }
    demand(!Object.hasOwn(s,'cargoRevision')||s.cargoRevision===1,'未対応の荷物形式');
    if(s.rollback)demand((s.cargoRevision===1)===(s.rollback.cargoRevision===1),'荷物形式と復元スナップショット');
    demand(['town','road','deployment','battle','camp','arrival','result'].includes(s.phase),'進行段階');
    demand(!!getPlace(s.location),'拠点');
    for(const key of ['gold','xp','hours','sequence','boardRound','completed'])demand(integer(s[key]),key);
    demand(s.partyRP===undefined||integer(s.partyRP),'パーティRP');
    demand(integer(s.level,1),'旧隊レベル');demand(validSelection(s.selected),'編成');
    demand(s.worldTime===undefined||integer(s.worldTime),'世界時刻');
    if(s.standaloneEvents!==undefined){demand(record(s.standaloneEvents)&&integer(s.standaloneEvents.epoch)&&record(s.standaloneEvents.events),'単発依頼予定');for(const q of STANDALONE_QUESTS){const event=s.standaloneEvents.events[q.eventId];demand(record(event)&&['available','accepted','completed','failed','missed'].includes(event.status),'単発依頼状態');}}
    demand(s.battleSelected===undefined?s.selected.length<=BATTLE_LIMIT:Array.isArray(s.battleSelected)&&s.battleSelected.length<=BATTLE_LIMIT&&new Set(s.battleSelected).size===s.battleSelected.length&&s.battleSelected.every(id=>s.selected.includes(id)),'戦闘出場者');
    if(version===1)demand(record(s.inventory)&&Object.keys(s.inventory).length===2&&integer(s.inventory.potion,0,99)&&integer(s.inventory.ether,0,99),'アイテム');
    else demand(!Object.hasOwn(s,'inventory'),'旧共通在庫と個人所持の重複');
    demand(Array.isArray(s.history)&&s.history.length<=200&&s.history.every(x=>typeof x==='string'),'履歴');
    demand(s.updatePlanRevision===undefined||s.updatePlanRevision===1,'未対応の候補者形式');
    const expected=s.updatePlanRevision===1?[...B.recruitRoster,...(B.legacyRoster.some(t=>Object.hasOwn(s.characters||{},t.id))?B.legacyRoster:[])]:B.legacyRoster;
    demand(record(s.characters)&&Object.keys(s.characters).length===expected.length&&expected.every(t=>Object.hasOwn(s.characters,t.id)),'キャラ一覧');
    demand(s.selected.every(id=>Object.hasOwn(s.characters,id)),'編成の人物');
    for(const t of expected) {
      const c=s.characters[t.id];demand(record(c)&&c.id===t.id&&c.race===(t.race??bases[t.job].race)&&((c.element===undefined)||['fire','water','earth','none'].includes(c.element))&&(t.sex===undefined?c.sex===undefined:c.sex===t.sex)&&Object.keys(c).every(k=>['id','equipmentRevision','combatRevision','element','race','sex','weapon','armor','accessory1','accessory2','leftHand','head','lowerBody','feet','hp','mp','def','xp','level','statPoints','skillPoints','allocations',...(version===2?['inventory']:[])].includes(k)),'キャラ情報');
      demand(c.def===undefined||integer(c.def),'キャラDEF');
      if(version===2){
        demand(record(c.inventory),'個人の所持品');
        demand(!Object.keys(c.inventory).some(id=>(getGear(id)?.type==='empty'||getGear(id)?.virtualDefault)),'所持品に空の装備枠が含まれています。元セーブと現在の進行は変更していません。正常な別セーブを選んでください');
        demand(Object.entries(c.inventory).every(([id,count])=>Cargo.isKey(id)?Cargo.validEntry(s,t.id,id,count):(items.some(item=>item.id===id)||getGear(id)&&getGear(id).type!=='empty')&&integer(count,1,1e10)),'個人の所持品');
      }
      demand(c.equipmentRevision===undefined||c.equipmentRevision===2,'装備移行版');
      demand(c.combatRevision===undefined||c.combatRevision===1,'戦闘スキル移行版');
      demand(record(c.allocations)&&Object.keys(c.allocations).length===3&&['str','int','agi'].every(k=>integer(c.allocations[k])),'能力配分');
      demand(integer(c.xp)&&c.level===1+Math.floor(c.xp/100)&&integer(c.statPoints)&&integer(c.skillPoints),'キャラ成長');
      demand(c.statPoints+Object.values(c.allocations).reduce((a,b)=>a+b,0)===(c.level-1)*2&&c.skillPoints===c.level-1,'獲得ポイント');
      if(getGear(c.weapon)?.type==='bow')demand(!c.leftHand||c.leftHand==='empty-leftHand',`弓は両手装備です。${c.id} の左手 ${c.leftHand} と競合しています。元セーブと現在の進行は変更していません。旧版で左手を空けて別名保存してから読み込んでください`);
      demand(getGear(c.leftHand)?.type!=='bow',`弓は右手に装備して両手を占有します。${c.id} の左手 ${c.leftHand} は自動移動・破棄しません。元セーブを保持し、旧版で右手へ移して左手を空け、別名保存してください`);
      for(const slot of Object.keys(S.slots)){const id=c[S.storage(slot)];demand(id===undefined||typeof id==='string'&&!!getGear(id)&&S.allowed(getGear(id)).includes(slot),'保存された装備枠');}
      const eq=equipment(c),used=[];demand(getGear(eq.rightHand)?.hands!==2||eq.leftHand==='empty-leftHand','両手装備の占有競合');for(const [slot,id] of Object.entries(eq)){const g=getGear(id);demand(!!g&&S.allowed(g).includes(slot),'装備枠');demand(eligibility(s,c.id,id).ok,'装備条件');if(!id.startsWith('empty-')){demand(!used.some(old=>old.id===S.identity(id)&&!separateHandCopies(g,old.slot,slot)),'装備の二重使用');used.push({id:S.identity(id),slot});}}
      demand(eligibility(s,c.id,c.weapon).ok&&eligibility(s,c.id,c.armor).ok,'装備条件');
      const st=stats(c);demand(integer(c.hp,0,st.max)&&integer(c.mp,0,st.maxMp),'HP/MP');
    }
    demand(s.activeQuest===null||record(s.activeQuest),'依頼');
    if(s.activeQuest) {
      const q=s.activeQuest;demand(typeof q.id==='string'&&typeof q.name==='string'&&typeof q.client==='string'&&typeof q.cargo==='string'&&typeof q.text==='string','依頼内容');
      if(Object.hasOwn(q,'cargoItemId')||Object.hasOwn(q,'cargoOwnerId'))demand(q.cargoItemId===Cargo.key(q.token)&&template(q.cargoOwnerId)?.job==='porter'&&Cargo.carriers(s).length===1&&Cargo.carriers(s)[0]===q.cargoOwnerId,'依頼荷物と所持者');
      demand((s.cargoRevision===1?getPlace(q.from)&&getPlace(q.to)&&routes[q.from]?.includes(q.to):q.from===s.location&&destinations(s).some(p=>p.id===q.to))&&integer(q.reward,0,10000)&&integer(q.xp,0,1000)&&integer(q.deadline,1,100)&&integer(q.weight,1,100)&&q.token===s.sequence,'依頼条件');
      demand(q.rewardRevision===undefined||q.rewardRevision===1,'依頼報酬形式');
      demand(q.rewardType===undefined||['money','experience'].includes(q.rewardType),'依頼報酬種別');
      if(q.elapsedHours!==undefined)demand(integer(q.elapsedHours),'依頼経過時間');
      if(s.cargoRevision===1)demand(q.cargoItemId===Cargo.key(q.token)&&Cargo.carriers(s).length===1,'荷物形式');
      demand(s.phase!=='result','報酬の二重取得');
    }
    if(version===2)demand(Object.entries(inventoryTotals(s,Object.keys(s.characters))).every(([id,count])=>integer(count+I.count(s.warehouse,id),0,99)),'消耗品合計（従来の99個上限）');
    demand(s.rollback===null||record(s.rollback),'復元情報');
    if(s.rollback){demand(depth===0&&s.rollback.rollback===null&&s.rollback.phase==='town'&&s.rollback.activeQuest===null,'復元スナップショット');validateState(s.rollback,1,version);}
    const tripPhases=['road','deployment','battle','camp','arrival'];
    if(tripPhases.includes(s.phase))demand(record(s.journey)&&s.rollback!==null,'進行中の旅');
    if(s.phase==='town')demand(s.journey===null&&s.battle===null&&s.result===null&&!!s.rollback===!!s.activeQuest,'街の状態');
    if(s.phase==='result')demand(record(s.result)&&['success','late','travel','failed'].includes(s.result.outcome)&&s.activeQuest===null&&s.rollback===null&&s.battle===null,'結果');
    if(s.journey!==null) {
      const j=s.journey;demand(record(j)&&getPlace(j.origin)&&getPlace(j.destination)&&(j.returning===true?j.destination===j.origin&&routes[j.origin]?.includes(j.outboundDestination)&&['short','safe'].includes(j.outboundRoute)&&j.stage>=1:j.origin!==j.destination&&routes[j.origin]?.includes(j.destination)),'旅の経路');
      demand(j.returning===undefined||typeof j.returning==='boolean','帰路状態');
      demand(j.outboundRoute===undefined||['short','safe'].includes(j.outboundRoute),'通過経路');
      demand(Array.isArray(j.history)&&j.history.every(x=>typeof x==='string')&&validSelection(j.selected)&&JSON.stringify(j.selected)===JSON.stringify(s.selected),'旅の編成');
      demand(integer(j.hours)&&integer(j.stage,0,2)&&j.token===s.sequence&&['convoy','flank'].includes(j.formation)&&typeof j.questless==='boolean','旅の条件');
      demand(s.phase==='result'||j.questless===!s.activeQuest,'依頼の有無');
      demand(s.phase==='result'||s.location===j.origin,'出発地点');
      demand(j.phase===(s.phase==='arrival'?'delivery':s.phase),'旅の段階');
      demand(integer(j.potions,0,99)&&record(j.job)&&typeof j.job.name==='string'&&integer(j.job.deadline,1,100000000)&&integer(j.job.reward),'旅の荷物');
      if(s.activeQuest)demand(j.job.id===s.activeQuest.id&&j.job.name===s.activeQuest.name&&j.job.deadline===s.activeQuest.deadline&&j.job.reward===s.activeQuest.reward&&(s.cargoRevision===1||j.destination===s.activeQuest.to),'旅と依頼の一致');
      if(j.questless)demand(j.job.name==='未受注の移動'&&j.job.deadline===100000000&&j.job.reward===0&&Object.keys(j.job).length===3,'未受注の旅情報');
      demand(typeof j.rested==='boolean','休息状態');
      if(j.party!==null){
        demand(Array.isArray(j.party)&&j.party.length===s.selected.length&&JSON.stringify(j.party.map(u=>u.id))===JSON.stringify(s.selected),'旅のHP記録');
        for(const u of j.party){const st=stats(s.characters[u.id]);demand(['name','role','icon','image'].every(k=>typeof u[k]==='string'&&u[k].length>0),'旅のキャラ表示');demand(u.job===template(u.id).job&&u.max===st.max&&u.maxMp===st.maxMp&&integer(u.hp,0,st.max)&&integer(u.mp,0,st.maxMp),'旅のHP/MP');}
      }
      if(['camp','arrival'].includes(s.phase))demand(Array.isArray(j.party)&&j.party.length===s.selected.length&&j.stage===(s.phase==='arrival'?2:1),'野営・到着');
      if(s.phase==='road')demand(j.stage<2,'街道の区間');
    } else demand(['town','result'].includes(s.phase),'旅情報なし');
    if(s.battle!==null) {
      const b=s.battle,j=s.journey,ids=battleIds(s);demand(record(b)&&['deployment','battle'].includes(s.phase)&&b.campaignToken===j.token&&b.campaignStage===j.stage,'戦闘の対応');
      demand(b.formationVersion===undefined||[1,2].includes(b.formationVersion)&&['convoy','flank'].includes(b.formationKind)&&b.formationKind===j.formation&&(b.formationVersion===2||s.phase==='battle'),'陣形条件の版');
      demand(b.formationVersion!==undefined||b.formationKind===undefined,'陣形条件の版なし');
      demand(Array.isArray(b.units)&&b.units.length>=(s.phase==='deployment'?1:2)&&b.units.length<=10&&new Set(b.units.map(u=>u.id)).size===b.units.length,'戦闘人数');
      demand(JSON.stringify(b.units.filter(u=>u.side==='ally').map(u=>u.id))===JSON.stringify(ids),'味方の一致');
      demand(b.units.some(u=>u.side==='enemy')&&b.units.every(u=>['ally','enemy'].includes(u.side)),'敵味方');
      demand(integer(b.actions)&&record(b.potions)&&integer(b.potions.ally,0,99)&&integer(b.potions.enemy,0,99)&&Array.isArray(b.log)&&b.log.every(line=>typeof line==='string')&&Array.isArray(b.recentEnemies)&&b.recentEnemies.every(e=>record(e)&&typeof e.name==='string'&&typeof e.action==='string'),'戦闘資源');
      demand(b.ethers===undefined||integer(b.ethers,0,99),'戦闘エーテル');
      if(version===2){
        demand(record(b.itemInventories)&&Object.keys(b.itemInventories).length===ids.length&&ids.every(id=>record(b.itemInventories[id])&&Object.keys(b.itemInventories[id]).length===items.length&&items.every(item=>integer(b.itemInventories[id][item.id],0,99)&&b.itemInventories[id][item.id]<=I.count(s.characters[id].inventory,item.id))),'戦闘の個人所持品');
        const remaining=id=>ids.reduce((n,uid)=>n+b.itemInventories[uid][id],0);
        demand(remaining('potion')===b.potions.ally&&remaining('ether')===b.ethers,'戦闘残数と個人所持の一致');
      }
      demand(b.logDropped===undefined||integer(b.logDropped,0,Number.MAX_SAFE_INTEGER),'省略ログ件数');
      demand(b.victoryEffectsApplied===undefined||typeof b.victoryEffectsApplied==='boolean','勝利効果状態');
      demand(b.skillCooldownVersion===undefined||b.skillCooldownVersion===1,'スキルクールタイム形式');
      demand(b.weightRevision===undefined||b.weightRevision===1,'戦闘重量形式');
      demand(b.damageRevision===undefined||b.damageRevision===1,'戦闘属性ダメージ形式');
      demand(b.enemyEquipmentRevision===undefined||b.enemyEquipmentRevision===1,'敵装備形式');
      demand(b.skillEventSequence===undefined||integer(b.skillEventSequence,0,Number.MAX_SAFE_INTEGER),'発動連番');
      if(b.skillEvents!==undefined){
        demand(Array.isArray(b.skillEvents)&&b.skillEvents.length<=100,'発動履歴');
        let prior=0;
        for(const e of b.skillEvents){demand(record(e)&&integer(e.sequence,1,b.skillEventSequence||0)&&e.sequence>prior&&e.type==='skill.activated'&&Object.hasOwn(E.definitions,e.skillId)&&(e.classification===E.definitions[e.skillId].classification||s.updatePlanRevision===undefined&&e.skillId==='itemUse'&&e.classification==='active')&&b.units.some(u=>u.id===e.actorId),'発動情報');prior=e.sequence;}
      }
      demand((s.phase==='deployment')===!!b.deploying,'配置段階');
      demand(b.result===null||typeof b.result==='string','戦闘結果');
      const alivePositions=[];
      for(const u of b.units) {
        const base=template(u.side==='enemy'?u.id.replace(/^enemy-/, ''):u.id);demand(!!base&&u.job===base.job,'戦闘キャラ');
        demand(['id','name','role','icon','image'].every(key=>typeof u[key]==='string'&&u[key].length>0),'戦闘表示情報');
        demand(integer(u.max,1,100000000)&&integer(u.hp,0,u.max)&&integer(u.maxMp,0,100000000)&&integer(u.mp,0,u.maxMp)&&integer(u.pos,0,49),'戦闘能力');
        demand(integer(u.atk,0,100000000)&&integer(u.reach,0,10)&&typeof u.agi==='number'&&Number.isFinite(u.agi)&&u.agi>0&&u.agi<=100000000&&typeof u.next==='number'&&u.next>0&&typeof u.tie==='number','戦闘順');
        demand(integer(u.atkFire??0,0,100000000)&&integer(u.atkWater??0,0,100000000)&&integer(u.atkEarth??0,0,100000000),'戦闘属性ATK');
        demand(u.equippedSkill===undefined||u.equippedSkill===null||Object.hasOwn(skills,u.equippedSkill),'装備スキル');
        demand(u.canInvade===undefined||typeof u.canInvade==='boolean','侵入能力');
        demand(u.skipNextTurn===undefined||typeof u.skipNextTurn==='boolean','足払いの次回スキップ状態');
        const skillOptions=B.activeSkillOptions(u),optionKeys=new Set(skillOptions.map(option=>option.key));
        if(u.pendingStamp!==undefined){
          const pending=u.pendingStamp;
          demand(record(pending)&&Object.keys(pending).every(key=>['key','center','origin','cells'].includes(key))&&integer(pending.origin,0,49)&&integer(pending.center,0,49)&&skillOptions.some(option=>option.key===pending.key&&option.id==='stamp')&&isDeepStrictEqual(pending.cells,B.stampCells({pos:pending.origin},pending.center))&&pending.cells.length>0,'スタンプの予約');
          demand(!b.result,'終了後の予約');
        }
        demand(u.selectedSkillKey===undefined||typeof u.selectedSkillKey==='string'&&skillOptions.some(option=>option.key===u.selectedSkillKey&&option.id===u.selectedSkill),'選択スキルの付与元');
        demand(u.skillCooldowns===undefined||record(u.skillCooldowns)&&Object.entries(u.skillCooldowns).every(([key,value])=>optionKeys.has(key)&&value===1),'スキルのクールタイム');
        demand(!b.result||u.skillCooldowns===undefined||Object.keys(u.skillCooldowns).length===0,'終了後のクールタイム');
        for(const key of ['firstMoveUsed','returnUsed'])demand(u[key]===undefined||typeof u[key]==='boolean','一戦の使用状態');
        const returnOptions=B.returnSkillOptions(u),returnKeys=new Set(returnOptions.map(option=>option.key));
        demand(u.selectedReturnSkillKey===undefined||typeof u.selectedReturnSkillKey==='string'&&returnKeys.has(u.selectedReturnSkillKey),'選択した帰還の付与元');
        demand(u.returnUsedGrants===undefined||record(u.returnUsedGrants)&&Object.entries(u.returnUsedGrants).every(([key,value])=>returnKeys.has(key)&&value===true),'帰還の使用済み付与元');
        demand(!u.returnUsed||u.returnUsedGrants===undefined||returnOptions.every(option=>u.returnUsedGrants[option.key]===true),'旧帰還使用状態の整合');
        demand(u.effects===undefined||Array.isArray(u.effects)&&new Set(u.effects).size===u.effects.length&&u.effects.every(id=>(id==='invasion'||id==='returnHome'||E.definitions[id]?.classification==='passive')),'装飾効果');
        demand(u.covers===undefined||Array.isArray(u.covers)&&u.covers.length<=2&&new Set(u.covers).size===u.covers.length&&u.covers.every(id=>id!==u.id&&b.units.some(t=>t.id===id&&t.side===u.side)),'防衛線');
        demand(u.skillStage===undefined||integer(u.skillStage,1,100000000),'旧スキル段階');
        demand(integer(u.def??0)&&integer(u.defFire??0)&&integer(u.defWater??0)&&integer(u.defEarth??0)&&['fire','water','earth','none',undefined].includes(u.element),'戦闘DEF・属性');
        demand(typeof u.guard==='boolean'&&(u.cover===null||typeof u.cover==='string'&&b.units.some(t=>t.id===u.cover&&t.side===u.side))&&(u.boost===undefined||typeof u.boost==='boolean'),'戦闘支援状態');
        if(u.intent!==undefined){
          const intent=u.intent;demand(record(intent)&&['move','attack','skill','item','guard'].includes(intent.kind)&&Array.isArray(intent.cells)&&intent.cells.every(p=>integer(p,0,49)),'行動予告');
          demand(typeof intent.name==='string'&&typeof intent.reason==='string','行動予告の表示');
          demand(intent.target===null||typeof intent.target==='string'||integer(intent.target,0,49),'行動予告対象');
          demand(intent.path===undefined||Array.isArray(intent.path)&&intent.path.every(p=>integer(p,0,49)),'予告経路');
          demand(intent.destination===undefined||intent.destination===null||integer(intent.destination,0,49),'予告移動先');
          const skill=B.activeSkill(u),target=b.units.find(t=>t.id===intent.target);
          if(intent.kind==='guard')demand(intent.target===null&&intent.cells.length===0,'防御予告');
          else if(intent.kind==='move')demand(integer(intent.target,0,49)&&intent.destination===intent.target&&intent.cells.length===0,'移動予告');
          else if(intent.kind==='skill'&&skill==='stamp')demand(integer(intent.target,0,49)&&intent.cells.length>=1&&intent.cells.length<=3,'スタンプ予告');
          else {
            demand(!!target,'予告のキャラ対象');
            const offensive=intent.kind==='attack'||intent.kind==='skill'&&['archer','scout'].includes(skill);
            demand(offensive?target.side!==u.side&&intent.cells.length===1:target.side===u.side&&intent.cells.length===0,'予告の対象陣営');
            if(intent.kind==='skill'&&skill==='scout')demand(Array.isArray(intent.path)&&integer(intent.destination,0,49),'奇襲の経路と着地先');
          }
        }
        if(s.phase==='battle'&&u.side==='enemy'&&u.hp>0)demand(record(u.intent),'敵の予告なし');
        if(u.hp>0)alivePositions.push(u.pos);
        if(u.side==='enemy'){
          if(b.enemyEquipmentRevision===1){const loadout=enemyLoadout[u.job],weapon=getGear(loadout.weapon),shield=loadout.shield?getGear(loadout.shield):null,gearList=[weapon,...(shield?[shield]:[])],expectedEquipment={rightHand:weapon.id,...(shield?{leftHand:shield.id}:{})},expectedInventory=Object.fromEntries(Object.entries(loadout.inventory).map(([id,count])=>[id,integer(u.inventory?.[id],0,count)]));
            const gearSum=key=>gearList.reduce((n,g)=>n+(g[key]||0),0),weaponRecord=u.attackWeapons?.[0];
            demand(u.thrownWeapons===undefined&&u.max===base.max&&u.maxMp===base.mp&&u.atk===weapon.atk&&u.atkFire===weapon.atkFire&&u.atkWater===weapon.atkWater&&u.atkEarth===weapon.atkEarth&&u.agi===base.agi&&u.reach===weapon.reach&&u.weapon===weapon.type&&u.element===(elements[u.job]||'none')&&isDeepStrictEqual(u.equipment,expectedEquipment)&&Object.keys(u.inventory||{}).length===Object.keys(loadout.inventory).length&&Object.entries(expectedInventory).every(([id,valid])=>valid)&&Array.isArray(u.attackWeapons)&&u.attackWeapons.length===1&&weaponRecord?.itemId===weapon.id&&['atk','atkFire','atkWater','atkEarth','reach'].every(key=>weaponRecord[key]===(key==='reach'?weapon.reach:weapon[key]||0))&&['def','defFire','defWater','defEarth'].every(key=>u[key]===gearSum(key))&&u.equippedSkill===undefined&&u.effects===undefined&&u.activeSkills===undefined&&u.selectedSkill===undefined&&(u.skillSources===undefined||isDeepStrictEqual(normalizedSkillSources(u.skillSources),enemySkillSources(u))),'敵の装備・能力');
          }else demand(u.thrownWeapons===undefined&&u.max===base.max&&u.maxMp===base.mp&&u.atk===base.atk&&u.agi===base.agi&&u.reach===base.reach&&u.equippedSkill===undefined&&u.weapon===base.weapon&&u.effects===undefined&&u.activeSkills===undefined&&u.selectedSkill===undefined&&(u.skillSources===undefined||isDeepStrictEqual(normalizedSkillSources(u.skillSources),enemySkillSources(u)))&&u.attackWeapons===undefined&&u.attackBonus===undefined,'敵の基本能力');
        }
        if(u.side==='ally'){
          const equippedCharacter=clone(s.characters[u.id]);
          if(u.thrownWeapons!==undefined){
            demand(record(u.thrownWeapons)&&Object.keys(u.thrownWeapons).length>0&&Object.entries(u.thrownWeapons).every(([slot,id])=>['rightHand','leftHand'].includes(slot)&&id==='javelin-wood'&&equipment(equippedCharacter)[slot]===id),'投げ槍の回収状態');
            for(const slot of Object.keys(u.thrownWeapons))equippedCharacter[S.storage(slot)]='empty-'+slot;
          }
          const st=stats(equippedCharacter);
          // Validate the old thrown-spear definition before the one-time town
          // migration. This is limited to unmarked saves with the old reach and
          // no spearThrow grant; current saves must match the current master.
          if(s.updatePlanRevision===undefined&&u.attackWeapons?.some(w=>w.itemId==='javelin-wood'&&w.reach===3)&&!u.skillSources?.some(source=>source.id==='spearThrow')){
            st.attackWeapons=st.attackWeapons.map(w=>w.itemId==='javelin-wood'?{...w,reach:3,skill:null}:w);
            st.skillSources=st.skillSources.filter(source=>source.itemId!=='javelin-wood');
            st.activeSkills=st.activeSkills.filter(id=>id!=='spearThrow');st.skill=st.activeSkills[0]||null;
            if(st.attackWeapons[0]?.itemId==='javelin-wood')st.reach=3;
          }
          // Pre-update snapshots used an active item-use grant. Validate that old
          // snapshot contract before the one-time migration discards the battle.
          if(s.updatePlanRevision===undefined&&u.activeSkills?.includes('itemUse')){
            st.skillSources=st.skillSources.map(source=>source.id==='itemUse'?{...source,classification:'active'}:source);
            const supplied=[...new Set(st.skillSources.filter(source=>source.classification==='active'&&source.id!=='returnHome').map(source=>source.id))];
            st.activeSkills=u.job==='porter'?['porter',...supplied.filter(id=>['itemUse','legSweep','grapple','poleVault'].includes(id))]:supplied;
            st.effects=st.effects.filter(id=>id!=='itemUse');st.skill=st.activeSkills[0]||null;
          }
          if(s.updatePlanRevision===undefined&&s.characters[u.id].lowerBody==='cloth-lowerBody'&&!u.skillSources?.some(source=>source.id==='secretPouch')){
            st.skillSources=st.skillSources.filter(source=>!(source.id==='secretPouch'&&source.itemId==='cloth-lowerBody'));
            st.effects=st.effects.filter(id=>id!=='secretPouch');
          }
          const downNow=b.units.filter(other=>other.side==='ally'&&other.startedAlive&&other.hp<=0),survivors=b.partyAliveInitial-downNow.length;
          const share=survivors>0?(b.initialDownWeight+downNow.reduce((n,other)=>n+(other.carriedWeight||0),0))/survivors:0;
          const over=u.hp>0&&survivors>0&&(u.carriedWeight+share>st.str),weightPenalty=over?0.5:1;
          if(b.weightRevision===1)demand(typeof b.partyAliveInitial==='number'&&typeof b.initialDownWeight==='number'&&typeof u.carriedWeight==='number'&&typeof u.weightLimit==='number'&&typeof u.fallenWeightShare==='number'&&typeof u.overburdened==='boolean'&&typeof u.baseAgi==='number'&&typeof u.startedAlive==='boolean','戦闘重量情報');
          const savedSpeed=b.weightRevision===1?u.agi===st.speed*weightPenalty:u.agi===st.speed;
          demand(u.max===st.max&&u.maxMp===st.maxMp&&u.atk===st.atk&&savedSpeed&&(b.weightRevision!==1||u.baseAgi===st.speed&&u.overburdened===over&&u.weightLimit===st.str)&&u.reach===st.reach&&u.equippedSkill===st.skill,'装備能力の一致');
          demand(b.damageRevision!==1||u.atkFire===st.atkFire&&u.atkWater===st.atkWater&&u.atkEarth===st.atkEarth&&u.def===st.def&&u.defFire===st.defFire&&u.defWater===st.defWater&&u.defEarth===st.defEarth&&u.element===st.element,'属性能力の一致');
          demand(s.characters[u.id].equipmentRevision!==2||Array.isArray(u.attackWeapons)&&Array.isArray(u.skillSources)&&Array.isArray(u.activeSkills),'装備計算情報なし');
          const snapshotEquipment=s.characters[u.id].equipmentRevision===2?st.equipment:{weapon:st.equipment.rightHand,armor:st.equipment.upperBody,accessory1:st.equipment.accessory1,accessory2:st.equipment.accessory2};
          demand(u.equipment===undefined||isDeepStrictEqual(u.equipment,snapshotEquipment),'戦闘中の装備枠');
          const savedWeapons=u.attackWeapons?.map(({name,...w})=>w);
          const oldWeapons=st.attackWeapons.map(({name,...w})=>({slot:w.slot,itemId:w.itemId,atk:w.atk,reach:w.reach,skill:w.skill}));
          demand(u.attackWeapons===undefined||isDeepStrictEqual(savedWeapons,b.damageRevision===1?st.attackWeapons.map(({name,...w})=>w):oldWeapons),'通常攻撃武器');
          demand(u.attackBonus===undefined||u.attackBonus===st.attackBonus,'通常攻撃補正');
          demand((u.attackWeapons===undefined)===(u.attackBonus===undefined),'通常攻撃情報');
          demand(u.activeSkills===undefined||JSON.stringify(u.activeSkills)===JSON.stringify(st.activeSkills),'アクティブ一覧');
          demand(u.skillSources===undefined||isDeepStrictEqual(normalizedSkillSources(u.skillSources),st.skillSources),'スキル装備源');
          demand((u.def??0)===(b.damageRevision===1?st.def:(s.characters[u.id].def??0)),'装備DEFの一致');
          demand(u.selectedSkill===undefined||st.activeSkills.includes(u.selectedSkill),'選択スキル');
          demand(u.effects===undefined||JSON.stringify(u.effects)===JSON.stringify(st.effects),'装飾能力の一致');
          demand(u.canInvade===undefined||u.canInvade===(u.job!=='porter'&&st.effects.includes('invasion')),'侵入権限の一致');
          demand(!s.characters[u.id].accessory1&&!s.characters[u.id].accessory2||u.effects!==undefined,'装飾効果なし');
          demand(!u.firstMoveUsed||st.effects.includes('firstStride'),'先駆けの装備');demand(!u.returnUsed||st.effects.includes('returnHome'),'帰還の装備');
          demand(!u.covers?.length||st.activeSkills.includes('defenseLine'),'防衛線の装備');
        }
      }
      demand(new Set(alivePositions).size===alivePositions.length,'配置重複');
      demand(b.actor===null||b.units.some(u=>u.id===b.actor&&u.side==='ally'&&u.hp>0),'行動者');
      if(s.phase==='battle'&&!b.result)demand(b.actor!==null,'行動者なし');
      if(b.result)demand(b.actor===null&&(b.units.filter(u=>u.side==='enemy').every(u=>u.hp===0)||b.units.some(u=>u.side==='ally'&&u.job==='porter'&&u.hp===0)||b.units.filter(u=>u.side==='ally').every(u=>u.hp===0)),'戦闘結果の不一致');
      demand(Array.isArray(b.deploymentInitial)&&b.deploymentInitial.length===ids.length&&b.deploymentInitial.every(p=>ids.includes(p.id)&&integer(p.pos,0,49)&&B.boardOf(p.pos)==='ally')&&new Set(b.deploymentInitial.map(p=>p.pos)).size===ids.length&&new Set(b.deploymentInitial.map(p=>p.id)).size===ids.length,'初期配置');
    } else demand(!['deployment','battle'].includes(s.phase),'戦闘情報なし');
  }
  function serialize(s) {
    demand(s.cargoRevision===1,'保存前に旧形式の読込・移行が必要です');
    const checked=validate(s);if(!checked.ok)throw new Error(checked.error);
    const data=JSON.stringify({format:'5525-native-campaign',version:VERSION,cargoRevision:1,state:s},null,2);
    demand(Buffer.byteLength(data,'utf8')<=MAX_SAVE_BYTES,'保存サイズ');return data;
  }
  function migrateEquipment(s) {
    if(s.rollback)migrateEquipment(s.rollback);
    let changed=false;
    for(const c of Object.values(s.characters)) {
      if(c.equipmentRevision===2)continue;
      const setIds=['sword-wood','sword-iron-1'];
      if(setIds.includes(c.weapon)) {
        demand(!c.leftHand||c.leftHand==='empty-leftHand',`旧剣盾セットの分割先（左手）が ${c.leftHand} と競合しています。元セーブと現在の進行は変更していません。旧版で左手を空けて別名保存してから読み込んでください`);
        c.leftHand=c.weapon==='sword-wood'?'guard-shield-wood':'guard-shield-iron-1';
      } else demand(!setIds.includes(c.leftHand),'左手の旧剣盾セットは分割先が競合しています。元セーブを保持し、旧版で右手へ移して左手を空け、別名保存してください');
      c.equipmentRevision=2;changed=true;
    }
    if(changed&&s.battle)for(const u of s.battle.units.filter(u=>u.side==='ally')) {
      const st=stats(s.characters[u.id]);
      u.equippedSkill=st.skill;u.activeSkills=st.activeSkills;u.skillSources=st.skillSources;
      u.attackWeapons=st.attackWeapons;u.attackBonus=st.attackBonus;u.equipment=st.equipment;
    }
  }
  function migrateInventory(s) {
    // UI party portraits use this explicit saved order, never object-key order.
    const first=s.selected[0];
    demand(typeof first==='string'&&template(first)&&Object.hasOwn(s.characters,first),'旧在庫の受取人（編成の1キャラ目）が不在です。元セーブは変更していません');
    for(const c of Object.values(s.characters)){
      demand(!Object.hasOwn(c,'inventory'),'旧形式に個人在庫が混在しています');
      c.inventory={};
    }
    for(const item of items)if(s.inventory[item.id]>0)s.characters[first].inventory[item.id]=s.inventory[item.id];
    if(s.battle){
      const b=s.battle;b.ethers=b.ethers??s.inventory.ether;
      demand(b.potions.ally<=s.inventory.potion&&b.ethers<=s.inventory.ether,'戦闘残数が旧所持品を超えています');
      b.itemInventories=Object.fromEntries(s.selected.map(id=>[id,{potion:0,ether:0}]));
      b.itemInventories[first]={potion:b.potions.ally,ether:b.ethers};
    }
    delete s.inventory;s.version=VERSION;
    if(s.rollback)migrateInventory(s.rollback);
  }
  function migrateWorldEvents(s){
    if(!Number.isSafeInteger(s.worldTime))s.worldTime=s.hours;
    if(!s.standaloneEvents)s.standaloneEvents=freshWorldEvents(s.worldTime);
    if(s.rollback)migrateWorldEvents(s.rollback);
    syncWorld(s);
  }
  function deserialize(input) {
    let envelope;
    if(typeof input==='string'){demand(Buffer.byteLength(input,'utf8')<=MAX_SAVE_BYTES,'保存サイズ');try{envelope=JSON.parse(input);}catch(e){throw new Error('セーブJSONを読み取れません');}}
    else {safeTree(input);demand(Buffer.byteLength(JSON.stringify(input),'utf8')<=MAX_SAVE_BYTES,'保存サイズ');envelope=clone(input);}
    safeTree(envelope);
    if(envelope.cargoRevision!==undefined)demand(envelope.cargoRevision===1&&envelope.state?.cargoRevision===1,'荷物移行マーカー');
    demand(record(envelope)&&envelope.format==='5525-native-campaign'&&[1,VERSION].includes(envelope.version),'保存形式');
    validateState(envelope.state,0,envelope.version);
    // Only normalize an already-valid older save; never truncate before validation.
    const loaded=clone(envelope.state);
    migrateEquipment(loaded);
    if(envelope.version===1)migrateInventory(loaded);
    // A rollback is an alternative snapshot, never additional owned stock.
    // Refund each snapshot independently; removal makes migration idempotent.
    // Only the validated clone is touched, so source files/objects remain intact.
    function retirePaidFists(s) {
      if(s.rollback)retirePaidFists(s.rollback);
      let count=0;
      for(const c of Object.values(s.characters)) {
        count+=c.inventory['fist-1']||0;
        delete c.inventory['fist-1'];
        for(const slot of Object.keys(S.slots)) {
          const field=S.storage(slot);
          if(c[field]==='fist-1'){count++;c[field]=`empty-${slot}`;}
        }
      }
      if(!count)return;
      const refund=count*100;
      demand(integer(s.gold+refund),'旧拳＋1の返金後に所持金上限を超えます。元セーブは変更していません。所持金を調整して別名保存してください');
      s.gold+=refund;
      note(s,`旧拳＋1を${count}個、仮想拳へ移行。${refund}Gを返金。`);
    }
    retirePaidFists(loaded);
    if(envelope.cargoRevision===undefined&&loaded.cargoRevision===undefined){
      function upgradeCargo(s){
        if(s.rollback)upgradeCargo(s.rollback);
        if(s.activeQuest&&!s.activeQuest.cargoItemId){
          const owner=B.roster.filter(t=>t.job==='porter'&&s.characters[t.id]).sort((a,b)=>(a.id==='porter'?1:Number(a.id.split('-').pop()))-(b.id==='porter'?1:Number(b.id.split('-').pop())))[0];
          demand(owner,'旧依頼の荷物を持つポーターが存在しません。元セーブは変更していません。');
          Cargo.issue(s,owner.id);
        }
        s.cargoRevision=1;
      }
      upgradeCargo(loaded);
    }
    if(loaded.battle&&loaded.battle.formationVersion===undefined){loaded.battle.formationVersion=loaded.phase==='battle'?1:2;loaded.battle.formationKind=loaded.journey.formation;}
    function migrateCombatMetadata(s) {
      if(s.battle)s.battle.skillCooldownVersion=1;
      for(const c of Object.values(s.characters))c.def=c.def??0;
      if(s.rollback)migrateCombatMetadata(s.rollback);
      if(s.battle)for(const u of s.battle.units){
        u.def=u.def??0;
        if(u.side==='ally'){
          const nextSources=stats(battleCharacter(s.characters[u.id],u)).skillSources;
          // Retired real fists become virtual empty hands. Keep the same used grant
          // on that hand instead of clearing its wait or retaining an obsolete key.
          for(const old of normalizedSkillSources(u.skillSources)||[]){
            if(old.id!=='itemUse'||!/^fist(?:-[12])?$/.test(old.itemId||''))continue;
            const next=nextSources.find(source=>source.id===old.id&&source.slot===old.slot&&source.grantSlot===old.grantSlot&&source.itemId===`empty-${old.slot}`);
            if(!next)continue;
            const oldKey=JSON.stringify([old.slot,old.itemId,old.grantSlot]),newKey=JSON.stringify([next.slot,next.itemId,next.grantSlot]);
            if(u.selectedSkillKey===oldKey)u.selectedSkillKey=newKey;
            if(u.skillCooldowns&&Object.hasOwn(u.skillCooldowns,oldKey)){u.skillCooldowns[newKey]=u.skillCooldowns[oldKey];delete u.skillCooldowns[oldKey];}
          }
          u.skillSources=nextSources;
        }
        else if(u.job==='scout')u.skillSources=enemySkillSources(u);
      }
    }
    migrateCombatMetadata(loaded);
    function upgradeCombat(s) {
      if(s.rollback)upgradeCombat(s.rollback);
      for(const c of Object.values(s.characters)){
        c.combatRevision=1;
        // Preserve explicit no-element characters, while older saves inherit
        // the same provisional job element as newly created characters.
        if(c.element===undefined)c.element=elements[template(c.id)?.job]||'none';
      }
      const hadWeightState=s.battle?.weightRevision===1,hadEnemyLoadouts=s.battle?.enemyEquipmentRevision===1;
      if(s.battle){
        s.battle.weightRevision=1;s.battle.damageRevision=1;s.battle.enemyEquipmentRevision=1;
        if(!hadWeightState){
          const b=s.battle,active=new Set(b.units.filter(u=>u.side==='ally').map(u=>u.id));
          b.partyAliveInitial=s.selected.filter(id=>(b.units.find(u=>u.side==='ally'&&u.id===id)?.hp??s.characters[id].hp)>0).length;
          b.initialDownWeight=s.selected.filter(id=>(b.units.find(u=>u.side==='ally'&&u.id===id)?.hp??s.characters[id].hp)<=0).reduce((n,id)=>n+(carriedWeight(s,id).total??0),0);
          b.reserveDownWeight=s.selected.filter(id=>!active.has(id)&&s.characters[id].hp<=0).reduce((n,id)=>n+(carriedWeight(s,id).total??0),0);
        }
      }
      if(s.battle)for(const u of s.battle.units.filter(u=>u.side==='ally')) {
        const st=stats(battleCharacter(s.characters[u.id],u));u.element=st.element;
        if(!hadWeightState){const load=carriedWeight(s,u.id);u.carriedWeight=load.total??0;u.weightLimit=st.str;u.baseAgi=st.speed;u.startedAlive=u.hp>0;}
        u.atk=st.atk;u.atkFire=st.atkFire;u.atkWater=st.atkWater;u.atkEarth=st.atkEarth;u.def=st.def;u.defFire=st.defFire;u.defWater=st.defWater;u.defEarth=st.defEarth;u.reach=st.reach;
        u.equippedSkill=st.skill;u.activeSkills=st.activeSkills;u.skillSources=st.skillSources;
        u.attackWeapons=st.attackWeapons;u.attackBonus=st.attackBonus;u.equipment=st.equipment;
        if(u.selectedSkill!==undefined&&!st.activeSkills.includes(u.selectedSkill))delete u.selectedSkill;
      }
      if(s.battle&&!hadEnemyLoadouts)applyEnemyLoadouts(s.battle);
      if(s.battle&&!hadWeightState){
        const b=s.battle,newlyDown=b.units.filter(u=>u.side==='ally'&&u.startedAlive&&u.hp<=0),survivors=b.partyAliveInitial-newlyDown.length;
        const share=survivors>0?(b.initialDownWeight+newlyDown.reduce((n,u)=>n+(u.carriedWeight||0),0))/survivors:0;
        for(const u of b.units.filter(u=>u.side==='ally')){u.fallenWeightShare=u.hp>0?share:0;u.overburdened=u.hp>0&&survivors>0&&u.carriedWeight+share>u.weightLimit;u.agi=u.baseAgi*(u.overburdened?0.5:1);}
      }
    }
    upgradeCombat(loaded);
    function upgradeReturnGrants(s) {
      if(s.rollback)upgradeReturnGrants(s.rollback);
      for(const u of s.battle?.units||[]){
        // Old returnUsed exhausted the actor-wide allowance, so all old grants
        // remain exhausted. Migration never grants a fresh use in that battle.
        if(u.returnUsed===true&&u.returnUsedGrants===undefined)u.returnUsedGrants=Object.fromEntries(B.returnSkillOptions(u).map(option=>[option.key,true]));
      }
    }
    upgradeReturnGrants(loaded);
    if(loaded.updatePlanRevision===undefined){
      // Preserve already spent battle resources without completing the battle,
      // granting rewards or restoring the pre-quest rollback snapshot.
      if(loaded.phase==='battle'&&loaded.battle)for(const u of loaded.battle.units.filter(u=>u.side==='ally')){
        const c=loaded.characters[u.id];c.hp=u.hp;c.mp=u.mp;
        for(const item of items){const amount=loaded.battle.itemInventories?.[u.id]?.[item.id];if(amount!==undefined){if(amount)c.inventory[item.id]=amount;else delete c.inventory[item.id];}}
      }
      for(const c of Object.values(loaded.characters))for(const id of Object.keys(c.inventory))if(Cargo.isKey(id))delete c.inventory[id];
      for(const t of B.recruitRoster){demand(!Object.hasOwn(loaded.characters,t.id),'候補者IDの競合');loaded.characters[t.id]=character(t.id);}
      loaded.location='astaris';loaded.phase='town';loaded.activeQuest=null;loaded.journey=null;loaded.battle=null;loaded.rollback=null;loaded.result=null;
      loaded.warehouse??={};loaded.updatePlanRevision=1;loaded.inventoryRevision=1;
      note(loaded,'アスタリスに戻りました。受注中の依頼と荷物を解除し、ギルドに新たな候補者が加わりました。');
    }
    migrateWorldEvents(loaded);
    const checked=validate(loaded);if(!checked.ok)throw new Error(checked.error);
    if(loaded.battle)B.trimLog(loaded.battle);return loaded;
  }
  const {purchaseQuote,buyInventory,purchasePlan,buyPlan,saleQuote,sellInventory,saleAvailable}=require('./shop-transactions.js')({I,S,clone,record,integer,getGear,template,shop,equipment,eligibility,stats,syncCharacter,validate,inventoryToken,inventoryCapacity,commitInventory,note,createHash});
  const {warehouseQuote,warehouseAction,warehouseView}=require('./warehouse.js')({I,getGear,items,template,inventoryToken,commitInventory,inventoryCapacity,note});
  return {warehouseQuote,warehouseAction,inventoryCapacity,VERSION,MAX_SAVE_BYTES,equipment,slots:S.slots,locations,gear,items,materials,provisional,create,createLegacy,view,board,scenarioAftermath,scenarioStages,destinations,hasPorter,stats,
    recipientMeeting,questRewards,canTurnBack,turnBack,select,accept,depart,travel,deploy,deployment_assign,chooseFormation,deployment_reset,begin,act,retreat,finishBattle,rest,waitForEvent,onward,forecast,arrive,acknowledge,
    completeQuest,eligibility,shop,quote,buyGear,buyItem,inn,useItem,inventoryTotals,inventoryToken,inventoryQuote,inventoryAction,inventoryView,purchaseQuote,buyInventory,purchasePlan,buyPlan,saleQuote,sellInventory,saleAvailable,allocate,allocateBatch,allocationToken,previewGear,trial,trialAct,validate,serialize,deserialize};
})();
module.exports = Campaign;
