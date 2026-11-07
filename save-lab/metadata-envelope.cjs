'use strict';
// Godot adds UI identity, audio state and embedded portraits outside the native
// campaign envelope. Validate separately; never re-encode or discard them.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {isDeepStrictEqual} = require('node:util');
const MAX_BYTES = 1024 * 1024; // Deliberate tool limit, including portraits.
const CORE = ['format','version','cargoRevision','state'];
const ADDONS = ['godotCampaignId','godotFrontend','nativePortraits'];
const own = (o,k) => Object.hasOwn(o,k);
const fail = message => { throw Error('Godot付加情報: ' + message); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function bounded(v, depth = 0) {
  if (depth > 35) fail('データが深すぎます');
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e10) return;
  if (typeof v === 'string' && v.length <= 4000) return;
  if (Array.isArray(v) && v.length <= 2000) { for (const x of v) bounded(x,depth+1); return; }
  if (!record(v) || Object.keys(v).length > 100) fail('未対応の値またはサイズです');
  for (const [k,x] of Object.entries(v)) {
    if (['__proto__','constructor','prototype'].includes(k)) fail('禁止されたキーです');
    bounded(x,depth+1);
  }
}
function otherFields(v, known) { for (const [k,x] of Object.entries(v)) if (!known.includes(k)) bounded({[k]:x}); }
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) { crc ^= b; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function validatePng(bytes) {
  if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('立ち絵がPNGではありません');
  let at=8, header, palette=false, seenIdat=false, endedIdat=false, end=false;
  const data=[];
  while (at < bytes.length) {
    if (at+12 > bytes.length) fail('PNGチャンクが不完全です');
    const n=bytes.readUInt32BE(at), stop=at+12+n;
    if (stop > bytes.length) fail('PNGチャンクの長さが不正です');
    const type=bytes.toString('latin1',at+4,at+8), payload=bytes.subarray(at+8,at+8+n);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(at+4,at+8+n)) !== bytes.readUInt32BE(at+8+n)) fail('PNGのCRCが一致しません');
    if (!header && type !== 'IHDR') fail('PNGヘッダーがありません');
    if (type === 'IHDR') {
      if (header || at!==8 || n!==13) fail('PNGヘッダーが不正です');
      const w=payload.readUInt32BE(0),h=payload.readUInt32BE(4),depth=payload[8],color=payload[9],interlace=payload[12];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (w<1||h<1||w>256||h>256||!depths[color]?.includes(depth)||payload[10]!==0||payload[11]!==0||interlace>1) fail('立ち絵は1〜256pxの対応PNGが必要です');
      header={w,h,depth,color,interlace};
    } else if (type === 'PLTE') {
      if (palette||seenIdat||n===0||n%3||n>768||[0,4].includes(header.color)) fail('PNGパレットが不正です');
      if (header.color===3 && n/3>2**header.depth) fail('PNGパレットが大きすぎます');
      palette=true;
    } else if (type === 'IDAT') {
      if (endedIdat || header.color===3&&!palette) fail('PNG画像データの順序が不正です');
      seenIdat=true;data.push(payload);
    } else {
      if (seenIdat) endedIdat=true;
      if (type === 'IEND') { if(n!==0||!seenIdat||stop!==bytes.length) fail('PNG終端が不正です'); end=true; }
      else fail('未対応のPNG補助・拡張チャンクです: '+type+'。画像を削除・変換せず読み込みを停止しました');
    }
    at=stop;
  }
  if (!end) fail('PNGが完結していません');
  const channels={0:1,2:3,3:1,4:2,6:4}[header.color];
  const passes=header.interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=[];let expected=0;
  for (const [x,y,dx,dy] of passes) {
    const w=Math.max(0,Math.ceil((header.w-x)/dx)),h=Math.max(0,Math.ceil((header.h-y)/dy));
    if (!w||!h) continue;
    const stride=Math.ceil(w*channels*header.depth/8)+1;rows.push([h,stride]);expected+=h*stride;
  }
  let raster;
  try { raster=zlib.inflateSync(Buffer.concat(data),{maxOutputLength:expected+1}); }
  catch { fail('PNGの圧縮画像データが不正です'); }
  if (raster.length!==expected) fail('PNG画像サイズが一致しません');
  let offset=0;
  for (const [h,stride] of rows) for(let y=0;y<h;y++,offset+=stride) if(raster[offset]>4) fail('PNGフィルターが不正です');
}
function validateAddons(extras, core) {
  if (own(extras,'godotCampaignId') && (typeof extras.godotCampaignId!=='string'||! /^[0-9a-f]{32}$/.test(extras.godotCampaignId))) fail('キャンペーンIDが不正です');
  if (own(extras,'godotFrontend')) {
    const v=extras.godotFrontend;
    if (!record(v)) fail('画面設定はオブジェクトが必要です');
    bounded(v);
    if (Object.keys(v).length && v.version!==1) fail('未対応の画面設定バージョンです');
    if (own(v,'journey_key') && (typeof v.journey_key!=='string'||[...v.journey_key].length>200)) fail('旅の音楽キーが不正です');
    if (own(v,'quest_id') && !['','quest_01_open_road','quest_02_woodland','quest_03_quiet_horizon'].includes(v.quest_id)) fail('依頼の音楽IDが不正です');
  }
  if (!own(extras,'nativePortraits') || extras.nativePortraits===null) return;
  const v=extras.nativePortraits;
  if (!record(v)||v.version!==1||!record(v.characters)) fail('未対応の立ち絵形式です');
  otherFields(v,['version','characters']);
  for (const [id,entry] of Object.entries(v.characters)) {
    if (!record(core.state?.characters)||!own(core.state.characters,id)) fail('立ち絵の対象キャラクターがセーブ内にありません');
    if (!record(entry)||typeof entry.png!=='string'||entry.png.length>400000||entry.png.length===0||entry.png.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(entry.png)) fail('立ち絵のbase64形式・サイズが不正です');
    if (typeof entry.sha256!=='string'||! /^[0-9a-f]{64}$/.test(entry.sha256)) fail('立ち絵のSHA-256形式が不正です');
    const bytes=Buffer.from(entry.png,'base64');
    if(bytes.toString('base64')!==entry.png) fail('立ち絵のbase64が正規形式ではありません');
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256) fail('立ち絵のSHA-256が一致しません');
    validatePng(bytes);otherFields(entry,['png','sha256']);
  }
}
function split(input) {
  let original=input;
  if (typeof input==='string') { if(Buffer.byteLength(input)>MAX_BYTES) fail('このツールは立ち絵を含め1 MiB以下に対応します'); try{original=JSON.parse(input);}catch{fail('JSONが不正です');} }
  if (!record(original)) fail('セーブはオブジェクトが必要です');
  const encoded=JSON.stringify(original);
  if (Buffer.byteLength(encoded)>MAX_BYTES) fail('このツールは立ち絵を含め1 MiB以下に対応します');
  for (const key of Object.keys(original)) if (![...CORE,...ADDONS].includes(key)) fail('未対応のセーブ付加項目: '+key+'。データ損失を避けるため読み込みを停止しました');
  const core={},extras={};
  for (const key of CORE) if(own(original,key)) core[key]=original[key];
  for (const key of ADDONS) if(own(original,key)) extras[key]=original[key];
  validateAddons(extras,core);
  return {original,core,extras};
}
function join(core,extras={}) {
  const combined={...core,...JSON.parse(JSON.stringify(extras))};
  split(combined);
  if (Buffer.byteLength(JSON.stringify(combined,null,2)+'\n')>MAX_BYTES) fail('保存内容が1 MiBを超えます');
  for(const key of Object.keys(extras)) if(!isDeepStrictEqual(combined[key],extras[key])) fail('付加情報の保持検証に失敗しました');
  return combined;
}
function summary(extras) {
  const portraits=Object.keys(extras.nativePortraits?.characters||{}).length;
  return {preservedKeys:Object.keys(extras),portraits};
}
module.exports={split,join,summary,MAX_BYTES};
