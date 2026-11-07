'use strict';

// Public regression data is generated only from deterministic artificial pixels.
// Do not replace these fixtures with a player's save or portrait.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const zlib = require('node:zlib');
const E = require('../engine.cjs');
const C = require('../vendor/5525/native/campaign.js');

const clone = value => JSON.parse(JSON.stringify(value));
const metadataKeys = ['nativePortraits', 'godotCampaignId', 'godotFrontend'];
const metadata = save => Object.fromEntries(metadataKeys.filter(key => Object.hasOwn(save, key)).map(key => [key, clone(save[key])]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function syntheticPng(width = 64, height = 64) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let seed = 0x55250102;
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0; // PNG filter None.
    for (let x = 0; x < width * 4; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      scanlines[row + 1 + x] = seed & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Eight bits per channel.
  ihdr[9] = 6; // RGBA.
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, {level: 0})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function withMetadata(save = E.run({cmd: 'new'})) {
  const result = clone(save);
  const id = result.state.selected[0];
  const png = syntheticPng();
  result.nativePortraits = {version: 1, characters: {[id]: {png: png.toString('base64'), sha256: hash(png)}}};
  result.godotCampaignId = '0123456789abcdef0123456789abcdef';
  result.godotFrontend = {version: 1, journey_key: '', quest_id: ''};
  return result;
}

function portrait(save) {
  return save.nativePortraits.characters[save.state.selected[0]];
}

function replacePortrait(save, bytes) {
  Object.assign(portrait(save), {png: bytes.toString('base64'), sha256: hash(bytes)});
}

function replacePngChunk(bytes, target, mutate) {
  const chunks = [bytes.subarray(0, 8)];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push(chunk(type, type === target ? mutate(Buffer.from(data)) : data));
    offset += length + 12;
  }
  return Buffer.concat(chunks);
}

function assertMetadataPreserved(actual, expected) {
  assert.deepEqual(metadata(actual), metadata(expected));
  const entry = portrait(actual);
  assert.equal(hash(Buffer.from(entry.png, 'base64')), entry.sha256);
}

function assertRejectedEverywhere(bad, label) {
  const original = JSON.stringify(bad);
  const good = withMetadata();
  for (const save of [bad, JSON.stringify(bad)]) {
    for (const cmd of ['normalize', 'inspect', 'edit']) {
      const request = {cmd, save, ...(cmd === 'edit' ? {patch: {gold: 777}} : {})};
      assert.throws(() => E.run(request), undefined, `${label}: ${cmd}`);
    }
    assert.throws(() => E.run({cmd: 'compare', before: good, after: save}), undefined, `${label}: compare after`);
    assert.throws(() => E.run({cmd: 'compare', before: save, after: good}), undefined, `${label}: compare before`);
  }
  assert.equal(JSON.stringify(bad), original, `${label}: input was mutated`);
}

function runTests() {
  let count = 0;
  const test = (name, fn) => {fn(); console.log('PASS ' + name); count++;};

  test('synthetic PNG is valid and reproduces the native long-string rejection', () => {
    const bytes = syntheticPng();
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
    const chunks = [];
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const body = bytes.subarray(offset + 4, offset + 8 + length);
      assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(body));
      chunks.push([body.subarray(0, 4).toString('ascii'), body.subarray(4)]);
      offset += length + 12;
    }
    assert.equal(offset, bytes.length);
    assert.deepEqual(chunks.map(([type]) => type), ['IHDR', 'IDAT', 'IEND']);
    assert.equal(zlib.inflateSync(chunks[1][1]).length, 64 * (1 + 64 * 4));
    assert.deepEqual(syntheticPng(), bytes);
    const save = withMetadata();
    assert.ok(portrait(save).png.length > 4000);
    assert.throws(() => C.deserialize(save), /文字列が長すぎます/);
  });

  test('normalize and inspect accept object or JSON text with exact metadata', () => {
    const save = withMetadata(), original = JSON.stringify(save);
    for (const input of [save, original]) {
      const normalized = E.run({cmd: 'normalize', save: input});
      assert.deepEqual(normalized, {save, migrated: false, warnings: []});
      assertMetadataPreserved(normalized.save, save);
      assert.equal(E.run({cmd: 'inspect', save: input}).summary.editable, true);
    }
    assert.equal(JSON.stringify(save), original);
  });

  test('edit and compare preserve metadata and only requested core state changes', () => {
    const save = withMetadata(), original = JSON.stringify(save);
    const edited = E.run({cmd: 'edit', save, patch: {gold: 777}});
    const expected = clone(save);
    expected.state.gold = 777;
    assert.deepEqual(edited, expected);
    assertMetadataPreserved(edited, save);
    assert.deepEqual(E.run({cmd: 'normalize', save: JSON.stringify(edited)}).save, expected);
    const diff = E.run({cmd: 'compare', before: save, after: edited});
    assert.deepEqual(diff.rows.map(row => [row.subject, row.field]), [['campaign', 'gold']]);
    assert.equal(JSON.stringify(save), original);
    assert.notEqual(edited.nativePortraits, save.nativePortraits);
    assert.notEqual(portrait(edited), portrait(save));
    portrait(edited).sha256 = '0'.repeat(64);
    assert.equal(JSON.stringify(save), original, 'returned metadata must not alias the input');
  });

  test('optional metadata is preserved without inventing absent fields', () => {
    const all = withMetadata();
    for (const present of [[], ['nativePortraits'], ['godotCampaignId'], ['godotFrontend']]) {
      const save = clone(all);
      for (const key of metadataKeys) if (!present.includes(key)) delete save[key];
      const normalized = E.run({cmd: 'normalize', save});
      assert.deepEqual(normalized.save, save);
      const edited = E.run({cmd: 'edit', save, patch: {gold: 777}});
      assert.deepEqual(metadata(edited), metadata(save));
    }
  });

  test('null portraits, empty frontend and known addon extras retain their exact form', () => {
    for (const additions of [
      {nativePortraits: null, godotFrontend: {}},
      {nativePortraits: {version: 1, characters: {}}, godotFrontend: {version: 1}},
    ]) {
      const save = {...E.run({cmd: 'new'}), ...additions};
      assert.deepEqual(E.run({cmd: 'normalize', save}), {save, migrated: false, warnings: []});
      assert.deepEqual(metadata(E.run({cmd: 'edit', save, patch: {gold: 777}})), metadata(save));
    }
    const save = withMetadata();
    save.nativePortraits.syntheticExtra = {label: '人工的な検証用の値', enabled: false, numbers: [0, 1, null]};
    portrait(save).syntheticExtra = {origin: 'deterministic-test-only', nested: [{keep: true}]};
    save.godotFrontend.syntheticExtra = {value: 'x'.repeat(4000), enabled: true};
    assert.deepEqual(E.run({cmd: 'normalize', save}).save, save);
    assertMetadataPreserved(E.run({cmd: 'edit', save, patch: {gold: 777}}), save);
  });

  test('frontend journey limit counts Unicode code points and accepts known quest IDs', () => {
    const save = withMetadata();
    save.godotFrontend.journey_key = '🧪'.repeat(200);
    for (const quest of ['', 'quest_01_open_road', 'quest_02_woodland', 'quest_03_quiet_horizon']) {
      save.godotFrontend.quest_id = quest;
      assert.deepEqual(E.run({cmd: 'normalize', save}).save, save);
    }
    save.godotFrontend.journey_key += '🧪';
    assertRejectedEverywhere(save, 'journey key exceeds 200 Unicode code points');
  });

  test('portrait image dimensions include the supported 256px boundary', () => {
    const save = withMetadata();
    replacePortrait(save, syntheticPng(256, 256));
    assert.ok(portrait(save).png.length <= 400000);
    assert.deepEqual(E.run({cmd: 'normalize', save}).save, save);
    replacePortrait(save, syntheticPng(257, 64));
    assertRejectedEverywhere(save, 'portrait width exceeds 256px');
    replacePortrait(save, syntheticPng(64, 257));
    assertRejectedEverywhere(save, 'portrait height exceeds 256px');
  });

  test('official legacy migration retains metadata and becomes idempotent', () => {
    const save = withMetadata(JSON.parse(C.serialize(C.createLegacy())));
    const original = JSON.stringify(save);
    const normalized = E.run({cmd: 'normalize', save});
    assert.equal(normalized.migrated, true);
    assert.ok(normalized.warnings.length > 0);
    assertMetadataPreserved(normalized.save, save);
    const core = clone(normalized.save);
    for (const key of metadataKeys) delete core[key];
    assert.equal(C.validate(C.deserialize(core)).ok, true);
    assert.deepEqual(E.run({cmd: 'normalize', save: normalized.save}), {save: normalized.save, migrated: false, warnings: []});
    assert.equal(JSON.stringify(save), original);
  });

  test('read-only non-town state retains its metadata', () => {
    const state = C.create();
    assert.equal(C.depart(state, 'east'), true);
    const save = withMetadata(JSON.parse(C.serialize(state))), original = JSON.stringify(save);
    assert.equal(E.run({cmd: 'inspect', save}).summary.editable, false);
    assert.deepEqual(E.run({cmd: 'normalize', save}).save, save);
    assert.deepEqual(E.run({cmd: 'compare', before: save, after: save}).rows, []);
    assert.throws(() => E.run({cmd: 'edit', save, patch: {gold: 777}}));
    assert.equal(JSON.stringify(save), original);
  });

  test('failed patches are atomic and cannot change the metadata envelope', () => {
    const save = withMetadata(), original = JSON.stringify(save);
    for (const patch of [{gold: -1}, {gold: 777, characters: {unknown: {hp: 1}}}, {nativePortraits: {}}, {godotCampaignId: 'f'.repeat(32)}, {godotFrontend: {version: 1}}]) {
      assert.throws(() => E.run({cmd: 'edit', save, patch}));
      assert.equal(JSON.stringify(save), original);
    }
  });

  test('invalid metadata fails closed across every input API', () => {
    const invalid = [
      ['wrong PNG hash', save => {portrait(save).sha256 = '0'.repeat(64);}],
      ['malformed PNG hash', save => {portrait(save).sha256 = 'not-a-sha256';}],
      ['invalid base64', save => {portrait(save).png = '%%%not-base64%%%';}],
      ['noncanonical base64 padding bits', save => {
        const entry = portrait(save), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        assert.ok(entry.png.endsWith('=='));
        const index = alphabet.indexOf(entry.png.at(-3));
        entry.png = entry.png.slice(0, -3) + alphabet[index ^ 1] + '==';
        assert.equal(hash(Buffer.from(entry.png, 'base64')), entry.sha256);
      }],
      ['base64 exceeds portrait limit', save => {portrait(save).png = 'AAAA'.repeat(100001);}],
      ['invalid PNG signature with matching hash', save => {
        const bytes = syntheticPng(); bytes[0] = 0;
        replacePortrait(save, bytes);
      }],
      ['invalid PNG CRC with matching hash', save => {
        const bytes = syntheticPng(); bytes[29] ^= 1;
        replacePortrait(save, bytes);
      }],
      ['high-bit PNG chunk type with matching CRC and hash', save => {
        const bytes = syntheticPng(), headerLength = bytes.readUInt32BE(8);
        bytes[12] |= 0x80; // C9 48 44 52 must not be decoded as ASCII IHDR.
        const checksum = crc32(bytes.subarray(12, 16 + headerLength));
        bytes.writeUInt32BE(checksum, 16 + headerLength);
        assert.equal(bytes.readUInt32BE(16 + headerLength), checksum);
        replacePortrait(save, bytes);
      }],
      ['invalid PNG compressed data with matching CRC and hash', save => {
        replacePortrait(save, replacePngChunk(syntheticPng(), 'IDAT', () => Buffer.from('not-zlib')));
      }],
      ['invalid PNG raster length with matching CRC and hash', save => {
        replacePortrait(save, replacePngChunk(syntheticPng(), 'IDAT', data => zlib.deflateSync(zlib.inflateSync(data).subarray(1))));
      }],
      ['invalid PNG row filter with matching CRC and hash', save => {
        replacePortrait(save, replacePngChunk(syntheticPng(), 'IDAT', data => {
          const raster = zlib.inflateSync(data); raster[0] = 5; return zlib.deflateSync(raster);
        }));
      }],
      ['unsupported portrait version', save => {save.nativePortraits.version = 999;}],
      ['unsupported frontend version', save => {save.godotFrontend.version = 999;}],
      ['missing nonempty frontend version', save => {delete save.godotFrontend.version;}],
      ['unknown frontend quest ID', save => {save.godotFrontend.quest_id = 'unknown_quest';}],
      ['uppercase campaign ID', save => {save.godotCampaignId = save.godotCampaignId.toUpperCase();}],
      ['wrong campaign ID length', save => {save.godotCampaignId = 'a'.repeat(31);}],
      ['nonhex campaign ID', save => {save.godotCampaignId = 'g'.repeat(32);}],
      ['uppercase portrait hash', save => {portrait(save).sha256 = portrait(save).sha256.toUpperCase();}],
      ['portrait character outside the saved roster', save => {
        save.nativePortraits.characters['synthetic-unknown-character'] = clone(portrait(save));
      }],
      ['oversized extra metadata string', save => {portrait(save).syntheticExtra = 'x'.repeat(4001);}],
      ['unknown envelope field', save => {save.unknownSaveLabMetadata = {version: 1};}],
    ];
    for (const [label, change] of invalid) {
      const save = withMetadata();
      change(save);
      assertRejectedEverywhere(save, label);
    }
  });

  test('unsupported ancillary PNG chunks reject without discarding or rewriting them', () => {
    const cases = [
      ['gAMA', Buffer.alloc(3), 'malformed gamma length'], // Requires four bytes.
      ['pHYs', Buffer.alloc(8), 'malformed pixel dimensions length'], // Requires nine bytes.
      ['cHRM', Buffer.alloc(31), 'malformed chromaticities length'], // Requires 32 bytes.
      ['sRGB', Buffer.from([255]), 'invalid rendering intent'], // Only values 0 through 3 are valid.
      ['tRNS', Buffer.from([0]), 'transparency chunk forbidden for RGBA'],
      ['tEXt', Buffer.from('Comment\0Synthetic fixture only', 'ascii'), 'valid text metadata outside the supported subset'],
    ];
    for (const [type, payload, label] of cases) {
      const png = syntheticPng();
      const inserted = chunk(type, payload);
      assert.equal(inserted.readUInt32BE(inserted.length - 4), crc32(inserted.subarray(4, -4)));
      const afterHeader = 8 + 12 + png.readUInt32BE(8);
      const bytes = Buffer.concat([png.subarray(0, afterHeader), inserted, png.subarray(afterHeader)]);
      const save = withMetadata();
      replacePortrait(save, bytes);
      assert.equal(hash(Buffer.from(portrait(save).png, 'base64')), portrait(save).sha256);
      assert.throws(() => E.run({cmd: 'normalize', save}), /PNG補助・拡張チャンク/, label);
      assertRejectedEverywhere(save, `${type}: ${label}`);
    }
  });

  test('metadata support does not relax the native core string limit', () => {
    const save = withMetadata();
    save.state.location = 'x'.repeat(4001);
    for (const input of [save, JSON.stringify(save)]) {
      assert.throws(() => E.run({cmd: 'normalize', save: input}), /文字列が長すぎます/);
      assert.throws(() => E.run({cmd: 'inspect', save: input}), /文字列が長すぎます/);
    }
    const core = clone(save);
    for (const key of metadataKeys) delete core[key];
    assert.throws(() => C.deserialize(core), /文字列が長すぎます/);
  });

  test('metadata support retains the whole-save one MiB input limit', () => {
    const save = withMetadata(), limit = 1024 * 1024;
    const encoded = JSON.stringify(save);
    const exactSize = encoded + ' '.repeat(limit - Buffer.byteLength(encoded));
    assert.equal(Buffer.byteLength(exactSize), limit);
    assert.deepEqual(E.run({cmd: 'normalize', save: exactSize}).save, save);
    assert.throws(() => E.run({cmd: 'normalize', save: exactSize + ' '}), /1 MiB/);
    const tooLarge = clone(save);
    tooLarge.godotFrontend.syntheticExtra = Array(280).fill('x'.repeat(3999));
    assert.ok(Buffer.byteLength(JSON.stringify(tooLarge)) > limit);
    assertRejectedEverywhere(tooLarge, 'whole-save byte limit');
  });

  console.log(`${count} metadata regression groups passed`);
}

module.exports = {syntheticPng, withMetadata, metadata};
if (require.main === module) runTests();
