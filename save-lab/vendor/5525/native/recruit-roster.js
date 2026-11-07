'use strict';
// Stable new identities: never reuse a legacy character ID when adding candidates.
module.exports=function(templates){
  const races={human:'人間',elf:'エルフ',dwarf:'ドワーフ'};
  const roles={porter:'ポーター',guard:'戦士',scout:'スカウト',mage:'魔法使い'};
  // Names are assigned to the existing 01 portrait for each role/race/sex.
  // The proposal also contains several 02 profiles; those are not roster IDs
  // yet, so they are intentionally not introduced here.
  const names={
    guard:{human:{male:'ガレス',female:'ミレイ'},elf:{male:'レオン',female:'セラ'},dwarf:{male:'グラント',female:'オルガ'}},
    scout:{human:{male:'カイル',female:'リオ'},elf:{male:'シオン',female:'ルシア'},dwarf:{male:'フィノ',female:'ネル'}},
    porter:{human:{male:'テオ',female:'ユノ'},elf:{male:'エルネ',female:'マリナ'},dwarf:{male:'バルト',female:'リッカ'}},
    mage:{human:{male:'カシアン',female:'ロゼ'},elf:{male:'イゼル',female:'メリナ'},dwarf:{male:'オルム',female:'フェリ'}},
  };
  return Object.entries(roles).flatMap(([job,role])=>Object.entries(races).flatMap(([race])=>['male','female'].map(sex=>{
    const base=templates.find(t=>t.job===job);
    return {...base,id:`recruit-${job}-${race}-${sex}`,job,role,race,sex,recruitRevision:1,
      image:`characters/${job}-${race}-${sex}-01.png`,
      name:names[job][race][sex]};
  })));
};
