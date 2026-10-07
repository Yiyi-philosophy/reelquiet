// ReelQuiet — Stage 1 species table: exactly 2 real species.
//
// D-SPECIES: real species only — real scientific name, size distribution,
//            depth zone and diel activity.
// D10:       `diet` is biology only. No bait name, affinity, probability,
//            multiplier or any other game number may appear in this file; every
//            game number lives in `src/core/params.ts`. `src/core/schema.ts`
//            enforces both rules, and `tests/species.test.ts` runs it.
// C2 + T1:   the hooks module cannot import `.json` (the loader only takes
//            code-named files), so this TypeScript module is the single source
//            of truth for species data. There is deliberately no
//            `data/species.json`.
//
// Sources: Stage 2b's rule is "names and classification from Wikidata (CC0),
// descriptions written ourselves, every field sourced; never copy FishBase
// (CC BY-NC)". Stage 1 cites written summaries rather than Wikidata item IDs,
// because a wrong Q-number would be worse than an honest note.
//
// Known Stage 1 content gap: with two species the pond only has something to
// offer in the epipelagic by day and the bathypelagic by night. Other
// depth/time combinations legitimately produce no bite — `loot.roll` returns
// null and the cast keeps waiting (and sinking). Stage 2b's 12 species close
// this; Stage 1 does not invent fish to fill it.

import type { Species } from '../core/types.ts'

export const SPECIES: readonly Species[] = [
  {
    id: 'atlantic-mackerel',
    common_name: 'Atlantic mackerel',
    scientific_name: 'Scomber scombrus',
    size_cm: { min: 20, typical: 30, max: 60 },
    depth_zone: 'epipelagic',
    activity: 'diurnal',
    rarity: 'common',
    source_refs: [
      'Written summary: Scomber scombrus is a schooling epipelagic fish of the North Atlantic and adjacent seas, staying in the upper few hundred metres of the water column.',
      'Written summary: adults are commonly around 30 cm in total length, with published records to roughly 60 cm; the 20 cm lower bound here is a conservative adult size for this table.',
      'Written summary: Atlantic mackerel are visual daytime feeders whose schools disperse at night, so this table records them as diurnal.',
    ],
    diet: {
      tags: ['plankton', 'small-crustaceans', 'small-fish'],
      source_refs: [
        'Written summary: Atlantic mackerel feed mainly on zooplankton — copepods and krill in particular — and take small fish and fish larvae as they grow.',
      ],
      note: 'Shifts from zooplankton toward small fish as it grows.',
    },
  },
  {
    id: 'common-fangtooth',
    common_name: 'common fangtooth',
    scientific_name: 'Anoplogaster cornuta',
    size_cm: { min: 6, typical: 12, max: 18 },
    depth_zone: 'bathypelagic',
    activity: 'nocturnal',
    rarity: 'rare',
    source_refs: [
      'Written summary: Anoplogaster cornuta is a deep-sea fish of tropical and temperate oceans worldwide; adults live mainly between about 500 m and several thousand metres, which places this table in the bathypelagic.',
      'Written summary: published maximum total length is about 18 cm; the 6 cm minimum and 12 cm typical value here are a conservative adult distribution under that maximum.',
      'Written summary: the species takes part in diel vertical migration, rising toward shallower water at night to feed, so this table records it as nocturnal.',
    ],
    diet: {
      tags: ['small-fish', 'small-crustaceans'],
      source_refs: [
        'Written summary: common fangtooth prey on fish and crustaceans; juveniles take mostly crustaceans and larger adults take more fish.',
      ],
      note: 'Juveniles lean on crustaceans; adults take more fish.',
    },
  },
]

export const SPECIES_BY_ID: Readonly<Record<string, Species>> = Object.freeze(
  SPECIES.reduce<Record<string, Species>>((acc, species) => {
    acc[species.id] = species
    return acc
  }, {}),
)

export default SPECIES
