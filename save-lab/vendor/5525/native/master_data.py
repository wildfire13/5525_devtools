"""Read-only runtime master loader and offline reproducible SQLite builder.
Never opens a save file. No schema migration is performed at runtime.
"""
import argparse
from contextlib import closing
import json
import math
import pathlib
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent / 'data'
SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(schema_version INTEGER NOT NULL CHECK(schema_version=1), content_version INTEGER NOT NULL CHECK(content_version>0));
CREATE TABLE skill(id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, definition TEXT, CHECK(definition IS NULL OR json_valid(definition)));
CREATE TABLE skill_level(skill_id TEXT NOT NULL REFERENCES skill(id), level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3), PRIMARY KEY(skill_id,level));
CREATE TABLE equipment(id TEXT PRIMARY KEY NOT NULL, ordinal INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, slot TEXT NOT NULL, type TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=0), properties TEXT NOT NULL CHECK(json_valid(properties)));
CREATE TABLE equipment_skill(equipment_id TEXT NOT NULL REFERENCES equipment(id), slot_no INTEGER NOT NULL CHECK(slot_no BETWEEN 1 AND 3), skill_id TEXT NOT NULL, level INTEGER NOT NULL, source_field TEXT NOT NULL CHECK(source_field IN ('skill','effect')), explicit_level INTEGER NOT NULL CHECK(explicit_level IN (0,1)), PRIMARY KEY(equipment_id,slot_no), FOREIGN KEY(skill_id,level) REFERENCES skill_level(skill_id,level));
CREATE INDEX grants_skill ON equipment_skill(skill_id,level);
CREATE TABLE equipment_legacy_skill(equipment_id TEXT PRIMARY KEY NOT NULL REFERENCES equipment(id), skill_id TEXT NOT NULL REFERENCES skill(id));
CREATE TABLE equipment_group(group_id TEXT NOT NULL CHECK(group_id IN ('extra','equipmentSkills')), ordinal INTEGER NOT NULL, equipment_id TEXT NOT NULL REFERENCES equipment(id), PRIMARY KEY(group_id,ordinal));
'''
CORE = ('id','name','slot','type','price')
FIELDS = ('skill','effect')
REFERENCE_FIELDS = FIELDS+('legacySkill',)
SLOTS = {'weapon','armor','head','upperBody','lowerBody','rightHand','leftHand','feet','accessory1','accessory2'}
KINDS = {'accessory','armor','book','bow','dagger','empty','fist','greatsword','hammer','other','rope','shield','spear','staff','sword'}
LEVELLED = {'itemUse','scout','archer','legSweep','grapple','poleVault','secretPouch','holePouch'}
NUMERIC_FIELDS = {'atk','atkFire','atkWater','atkEarth','def','defFire','defWater','defEarth','hp','mp','str','int','agi','reach','weight'}
SIGNED_FIELDS = {'agiBonus'}

def number(v, minimum=None):
    return type(v) in (int,float) and abs(v)<=9007199254740991 and math.isfinite(v) and (minimum is None or v>=minimum)

def validate_equipment(g):
    if g['slot'] not in SLOTS or g['type'] not in KINDS: raise ValueError('invalid equipment kind or slot')
    for key in NUMERIC_FIELDS:
        if key in g and not number(g[key],0): raise ValueError('invalid equipment number')
    for key in SIGNED_FIELDS:
        if key in g and not number(g[key]): raise ValueError('invalid equipment bonus')
    if 'grade' in g and not integer(g['grade']): raise ValueError('invalid equipment grade')
    if 'hands' in g and (type(g['hands']) is not int or g['hands'] not in (1,2)): raise ValueError('invalid hand count')
    if 'allowedSlots' in g:
        slots=g['allowedSlots']
        if not isinstance(slots,list) or not slots or any(not isinstance(x,str) or x not in SLOTS-{'weapon','armor'} for x in slots) or len(slots)!=len(set(slots)): raise ValueError('invalid allowed slots')
    for key in ('starterOnly','virtualDefault','purchasable','sellable','transferable','removable'):
        if key in g and type(g[key]) is not bool: raise ValueError('invalid equipment flag')
    if 'salePrice' in g and not integer(g['salePrice']): raise ValueError('invalid sale price')
    if 'raceOnly' in g and g['raceOnly'] not in ('human','elf','dwarf'): raise ValueError('invalid equipment race')
    if 'sexOnly' in g and g['sexOnly'] not in ('male','female'): raise ValueError('invalid equipment sex')
    if 'excludedRaces' in g:
        races=g['excludedRaces']
        if not isinstance(races,list) or any(not isinstance(x,str) or x not in ('human','elf','dwarf') for x in races) or len(races)!=len(set(races)): raise ValueError('invalid excluded races')
    for key in ('material','note','flavor','shopProductId'):
        if key in g and not isinstance(g[key],str): raise ValueError('invalid equipment text')
    if 'material' in g and g['material'] not in ('cloth','iron','leather','silver','wood','glass','steel'): raise ValueError('invalid material')
    if 'jobOnly' in g and g['jobOnly'] not in ('porter','guard','scout','mage','archer'): raise ValueError('invalid equipment job')

def integer(v, minimum=0):
    return type(v) is int and minimum <= v <= 9007199254740991

def validate(source):
    if source.get('schemaVersion') != 1 or not integer(source.get('contentVersion'),1):
        raise ValueError('unsupported master version')
    definitions=source['definitions']; legacy=source['legacySkills']
    if not isinstance(definitions,dict) or not isinstance(legacy,dict): raise ValueError('skill dictionaries required')
    for sid,d in definitions.items():
        if not isinstance(sid,str) or not sid or not isinstance(d,dict) or not isinstance(d.get('name'),str): raise ValueError('invalid skill')
        if d.get('classification') not in ('active','passive'): raise ValueError('invalid skill classification')
        if 'cost' in d and not integer(d['cost']): raise ValueError('invalid MP cost')
        if 'reach' in d and d['reach'] is not None and not number(d['reach'],0): raise ValueError('invalid skill reach')
        if 'target' in d and d['target'] not in ('item','self','unit','cell','pair','upToTwo'): raise ValueError('invalid skill target')
        if 'description' in d and not isinstance(d['description'],str): raise ValueError('invalid skill description')
    if any(not isinstance(k,str) or not k or not isinstance(v,str) or not v for k,v in legacy.items()): raise ValueError('invalid legacy skill')
    if set(definitions)&set(legacy): raise ValueError('overlapping skill identities')
    ids=set()
    for g in source['gear']:
        if not isinstance(g,dict) or any(not isinstance(g.get(k),str) or not g[k] for k in CORE[:-1]): raise ValueError('invalid equipment identity')
        if g['id'] in ids or not integer(g.get('price')): raise ValueError('duplicate equipment or invalid price')
        ids.add(g['id'])
        validate_equipment(g)
        for f in REFERENCE_FIELDS:
            if f in g and g[f] not in definitions and g[f] not in legacy: raise ValueError('unknown skill')
        if 'skillLevel' in g and (not integer(g['skillLevel'],1) or g['skillLevel']>3): raise ValueError('unsupported level')
    if any('shopProductId' in g and g['shopProductId'] not in ids for g in source['gear']): raise ValueError('unknown shop product')
    for name in ('extra','equipmentSkills'):
        group=source['groups'][name]
        if len(group)!=len(set(group)) or any(x not in ids for x in group): raise ValueError('invalid equipment group')
    seen=set()
    for grant in source['equipmentGrants']:
        key=(grant['equipmentId'],grant['slotNo'])
        if key in seen or key[0] not in ids or not integer(key[1],1) or key[1]>3:raise ValueError('invalid grant slot')
        seen.add(key)
        if grant['id'] not in definitions and grant['id'] not in legacy:raise ValueError('unknown grant skill')
        if grant['sourceField'] not in FIELDS or type(grant['explicitLevel']) is not bool:raise ValueError('invalid grant projection')
        if not integer(grant['level'],1) or grant['level']>3 or (grant['level']!=1 and grant['id'] not in LEVELLED):raise ValueError('invalid grant level')
    json.dumps(source,allow_nan=False)


def build(source_path, output):
    source=json.loads(pathlib.Path(source_path).read_text(encoding='utf-8'));validate(source)
    output=pathlib.Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent,delete=False) as f: temp=pathlib.Path(f.name)
    try:
        # The SQLite transaction context commits/rolls back but does not close.
        # Close both writer and validator before replacing the file on Windows.
        with closing(sqlite3.connect(temp)) as db, db:
            db.executescript(SCHEMA)
            db.execute('INSERT INTO metadata VALUES(1,?)',(source['contentVersion'],))
            for sid in sorted(set(source['definitions'])|set(source['legacySkills'])):
                d=source['definitions'].get(sid)
                db.execute('INSERT INTO skill VALUES(?,?,?)',(sid,d['name'] if d else source['legacySkills'][sid],json.dumps(d,ensure_ascii=False) if d else None))
                db.executemany('INSERT INTO skill_level VALUES(?,?)',[(sid,n) for n in ((1,2,3) if sid in LEVELLED else (1,))])
            for n,g in enumerate(source['gear']):
                rest={k:v for k,v in g.items() if k not in CORE+REFERENCE_FIELDS+('skillLevel',)}
                db.execute('INSERT INTO equipment VALUES(?,?,?,?,?,?,?)',(g['id'],n,g['name'],g['slot'],g['type'],g['price'],json.dumps(rest,ensure_ascii=False)))
            for g in source['gear']:
                if 'legacySkill' in g:db.execute('INSERT INTO equipment_legacy_skill VALUES(?,?)',(g['id'],g['legacySkill']))
            for grant in source['equipmentGrants']:
                db.execute('INSERT INTO equipment_skill VALUES(?,?,?,?,?,?)',(grant['equipmentId'],grant['slotNo'],grant['id'],grant['level'],grant['sourceField'],int(grant['explicitLevel'])))
            for group,ids in source['groups'].items():
                db.executemany('INSERT INTO equipment_group VALUES(?,?,?)',[(group,n,id_) for n,id_ in enumerate(ids)])
        # Validate the artifact before atomic replacement. A failed import preserves it.
        rebuilt=read(temp)
        for key in ('gear','definitions','legacySkills','groups','equipmentGrants'):
            if rebuilt[key]!=source[key]:raise ValueError('source and relational projection disagree')
        temp.replace(output)
    finally:
        if temp.exists():temp.unlink()


def read(path):
    path=pathlib.Path(path).resolve()
    if not path.is_file() or path.stat().st_size>16*1024*1024: raise ValueError('missing or oversized master')
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
        db.execute('PRAGMA query_only=ON');db.execute('PRAGMA foreign_keys=ON')
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('invalid master integrity')
        versions=db.execute('SELECT schema_version,content_version FROM metadata').fetchall()
        if len(versions)!=1 or versions[0][0]!=1 or not integer(versions[0][1],1): raise ValueError('unsupported master version')
        source={'schemaVersion':1,'contentVersion':versions[0][1],'gear':[],'definitions':{},'legacySkills':{},'groups':{'extra':[],'equipmentSkills':[]}}
        for sid,name,definition in db.execute('SELECT id,name,definition FROM skill ORDER BY id'):
            if definition is None:source['legacySkills'][sid]=name
            else:
                d=json.loads(definition)
                if d.get('name')!=name:raise ValueError('skill name mismatch')
                source['definitions'][sid]=d
        grants={}
        for eid,slot,sid,level,field,explicit in db.execute('SELECT equipment_id,slot_no,skill_id,level,source_field,explicit_level FROM equipment_skill ORDER BY equipment_id,slot_no'):
            if not integer(slot,1) or slot>3 or not integer(level,1) or level>3 or field not in FIELDS or explicit not in (0,1): raise ValueError('invalid grant')
            grants.setdefault(eid,[]).append({'slotNo':slot,'id':sid,'level':level,'sourceField':field,'explicitLevel':bool(explicit)})
        legacy_equipment=dict(db.execute('SELECT equipment_id,skill_id FROM equipment_legacy_skill'))
        for eid,ordinal,name,slot,kind,price,props in db.execute('SELECT * FROM equipment ORDER BY ordinal'):
            rest=json.loads(props)
            if not isinstance(rest,dict) or any(k in rest for k in CORE+REFERENCE_FIELDS+('skillLevel',)):raise ValueError('shadowed equipment field')
            g=dict(zip(CORE,(eid,name,slot,kind,price)));g.update(rest)
            if eid in legacy_equipment:g['legacySkill']=legacy_equipment[eid]
            for grant in grants.get(eid,[]):
                # Legacy projection only. All instances also returned independently.
                if grant['sourceField'] not in g:
                    g[grant['sourceField']]=grant['id']
                    if grant['explicitLevel'] and 'skillLevel' not in g:g['skillLevel']=grant['level']
            source['gear'].append(g)
        for group,ordinal,eid in db.execute('SELECT * FROM equipment_group ORDER BY group_id,ordinal'):
            if group not in source['groups']:raise ValueError('invalid group')
            source['groups'][group].append(eid)
        source['equipmentGrants']=[dict(equipmentId=g['id'],**grant) for g in source['gear'] for grant in grants.get(g['id'],[])]
        validate(source)
        source['grantsByEquipment']=grants
        return source

def runtime_probe():
    """Dependency check from a file: avoids native shell quoting of Python/SQL."""
    import PIL
    if sys.version_info < (3,10):raise ValueError('unsupported Python version')
    with closing(sqlite3.connect(':memory:')) as db:
        if db.execute('SELECT json_valid(?)',('{}',)).fetchone()!=(1,):raise ValueError('SQLite JSON support required')
        db.execute('PRAGMA foreign_keys=ON')
        if db.execute('PRAGMA foreign_keys').fetchone()!=(1,):raise ValueError('SQLite foreign keys required')
        db.executescript('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id));')
        try:db.execute('INSERT INTO child VALUES(1)')
        except sqlite3.IntegrityError:pass
        else:raise ValueError('SQLite foreign keys not enforced')
    return {'python':sys.version.split()[0],'pillow':PIL.__version__,'sqlite':sqlite3.sqlite_version}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['build','read','probe']);parser.add_argument('--source',default=str(ROOT/'master-source.json'));parser.add_argument('--db',default=str(ROOT/'master.sqlite'));args=parser.parse_args()
    try:
        if args.command=='probe':print(json.dumps(runtime_probe()))
        elif args.command=='build':build(args.source,args.db)
        else:print(json.dumps(read(args.db),ensure_ascii=False,allow_nan=False))
    except (ValueError,KeyError,TypeError,OSError,ImportError,sqlite3.Error):
        message='Python runtime dependencies are missing or incompatible.' if args.command=='probe' else 'Master database is missing, invalid, or incompatible.'
        print(message,file=sys.stderr);sys.exit(1)
