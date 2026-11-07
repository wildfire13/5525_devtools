# SQLite equipment/skill master

`master-source.json` is the reviewable offline source; `master.sqlite` is the
runtime artifact. Original IDs, all 58 gear records, and the 16 structured skill
definitions were captured from main 31f8c62 without changing numeric gameplay values. The loneWolf description now states the
authorized additive percentage rule; its numeric +25% per grant is unchanged.
No Excel proposal equipment has been added. Original save files are never
rewritten; validated legacy metadata is normalized only in the loaded copy.

Build from repository root:

    python native/master_data.py build
    python -m unittest discover -s native -p test_master_data.py

The build validates first, writes a sibling temporary file, verifies relational
roundtrip, and atomically replaces only the master artifact. A failed import
leaves the previous artifact untouched. Revert the source and rebuild to restore
an earlier master; restore source/artifact as a matching pair. Never edit a live
save to accommodate missing IDs. Keep legacy IDs and retired virtual fist entries
needed by existing migration code.

After a successful offline rebuild, restart the game to load the new master.
Runtime reads SQLite in read-only mode once per Node process, using the configured
`NATIVE5525_PYTHON` or `python`. It requires Python's sqlite3 module and a valid
schema version 1 artifact. Missing/invalid DB or Python does not fall back to old
hardcoded masters. Startup must report failure without replacing a save. Python
helper and data directory must be shipped alongside the native Node files.
Windows real UI/distribution verification belongs to the integration checklist;
Linux storage unit tests do not establish Windows compatibility.

Equipment core identity/price and skill grants are relational. Remaining legacy
properties are JSON to preserve omitted-vs-null and current adapters exactly.
`equipmentGrants` explicitly records equipmentId, slotNo (1..3), id, level,
sourceField, explicitLevel. Same skill IDs may appear in multiple slots. The
runtime API exposes all instances in `grantsByEquipment`, independently of legacy
`skill`/`effect` projection fields. Only the first grant per legacy
field is projected; its level is not overwritten by subsequent grants. full runtime behavior must consume the grant collection.
Source legacy fields must match this projection or import is rejected. Numeric
equipment fields, enumerated slots/types/materials/targets, flags, levels, prices,
and references are validated both during import and during read. JSON is only a
compatibility storage choice, not permission to bypass type checking.

The old sword/shield compatibility `legacySkill` reference is held separately in
`equipment_legacy_skill`, with foreign keys to equipment and skill. It is rebuilt
from `gear.legacySkill` and returned in that same field for old-save logic. It is
not an active grant and does not occupy one of the three editable grant slots.
No existing active grant ordinal is shifted by this separation.

Skill definitions not present in the old equipment-skills dictionary are retained
as `legacySkills` identity records (guard/archer/mage/scout/stamp/porter/invasion).
Their action rules and fallback explanations still live in existing JS/Godot;
this migration does not fabricate structured MP/range/effect data for them.
Skill-level rows describe existing identity ranges, not authorization to implement
new skill effects. Duplicate active actions are separate runtime selections with independent cooldowns;
storing duplicate grants must not silently repeat actions or costs. Cooldown state
belongs to battle/save state, never this master artifact.

Prices, inn duration, growth points, inventory capacity/weight, formations, quests,
and effects not explicitly authorized for this implementation stay unchanged.
This artifact is a master database, never a save database. Private workbook URLs,
reference recordings and conversation records are not included.

## Runtime grants and save compatibility

Product campaign battles use `skillCooldownVersion: 1`. Every active grant has
its own button, level and stable key (equipment slot, item ID, grant slot).
A committed use blocks that grant for the actor's next opportunity; completing
that opportunity, including an existing skipped turn, releases it. Another grant
of the same skill is independent. Selection, previews and cancelled/invalid
commands consume nothing. Item-use permissions also retain their source.
A return grant is instead usable once per battle; cooldown expiry never restores
that use. A previously saved actor-wide spent return remains spent for every
return grant on migration. Ordinary attacks and movement gain no new cooldown.

Current one-handed items may be separately owned and equipped in both hands.
Two-handed occupancy, non-hand duplicate restrictions, virtual fists and the
retired paid-fist migration are preserved. Percentage boosts add contributions
before multiplication (two +25% grants give +50%, not +56.25%). Other existing
passive activation conditions are not replaced by new rules.

The JSON save envelope remains compatible. Missing old grant ordinals are
normalized only after checking existing source information; exact selection,
cooldowns and spent-return keys are validated. Loading never rewrites the input
file. New battle units have no prior cooldown or spent-return state. Reverting
the application is not a guarantee that an older application can interpret a
save created with new dual-hand equipment; keep an original save copy.
