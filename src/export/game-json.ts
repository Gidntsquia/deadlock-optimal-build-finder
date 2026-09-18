// Converts a generated Build into the JSON shape consumed by scripts/export-to-game/export_to_game.py,
// which injects it into the local Steam Cloud cache as an "Unpublished" in-game build. This file only
// serializes plain data (item ids, ability ids, phases) — the Python tool owns everything about the
// game's on-disk format (KV3 + protobuf CMsgHeroBuild).
import type { Build, Hero, Phase } from '../types';

const PHASE_LABEL: Record<Phase, string> = { early: 'Early Game', mid: 'Mid Game', late: 'Late Game' };

// The in-game build editor lays out each category as a single row that grows wider to fit its items
// (see any real build, e.g. items side-by-side under "Early Game") — it does NOT wrap onto multiple
// rows within a fixed-width box. A fixed `width` with `height` scaled by row count (the previous
// approach here) produces stacked/overlapping items instead. So `width` scales with item count and
// `height` stays a single row.
const ITEM_WIDTH = 120;
const ROW_HEIGHT = 175;

// `tags` are NOT small sequential indices (an earlier version of this file guessed 1-13, which the
// game's tag picker rendered as "?"). Decoding a real cached_hero_builds.kv3 shows real builds' tags
// mixing two things from the same id-space as everything else in the game's data: a couple of generic
// "Standard Tag" ids shared across many builds/heroes (e.g. 47026193, 36498494 recur for hero_id 1, 18,
// 31...) and, critically, the literal ability/item ids of the build's standout abilities/items — e.g.
// Infernus's Afterburn ability (id 1593133799, from abilities.json) appears verbatim as a tag on every
// popular Infernus build. So a build's own most-important ability/item ids double as valid tag ids.

export interface GameBuildCategory {
  name: string;
  description: string;
  width: number;
  height: number;
  item_ids: number[];
}
export interface GameAbilityStep {
  ability_id: number;
  kind: 'unlock' | 'tier1' | 'tier2' | 'tier3';
}
export interface GameBuildJson {
  hero_id: number;
  hero_class_name: string;
  name: string;
  description: string;
  categories: GameBuildCategory[];
  ability_order: GameAbilityStep[];
  tags: number[];
}

function defaultName(build: Build, hero: Hero): string {
  const style = build.population.style;
  // "Standard build" is the generic fallback name stylePopulations assigns to the main population
  // when it has no defining items to distinguish it from a sibling style (see build.ts) — a
  // meaningless qualifier once we export just this one build, so drop it rather than surface it.
  const styleName = style && style.name !== 'Standard build' ? style.name.replace(/\s*build$/i, '') : null;
  return styleName ? `Monclan ${styleName} ${hero.name}` : `Monclan ${hero.name}`;
}

function defaultDescription(): string {
  return (
    'Generated from aggregate high-rank match stats: items and abilities are scored by usage rate and ' +
    'win rate, then assembled into a buy order.\n\n' +
    "Created with Claude's help via github.com/GidntSquia/deadlock-optimal-build-finder."
  );
}

// Tags the build with the ids of its most important abilities and item, verified against real
// in-game builds to render correctly (see the comment above). "Most important abilities" = the
// first two distinct abilities the build levels up (`kind: 'unlock'` in abilityOrder) — the priority
// combo the build is built around (for the standard Infernus build: Afterburn, then Flame Dash).
// "Most important item" = the highest-scoring item the generator picked for the build (for the
// standard Infernus build: Rapid Recharge). Together that's the same trio a human would name as the
// build's identity.
function relevantTags(build: Build): number[] {
  const abilityIds: number[] = [];
  for (const step of build.abilityOrder) {
    if (step.kind === 'unlock' && !abilityIds.includes(step.ability.id)) abilityIds.push(step.ability.id);
    if (abilityIds.length === 2) break;
  }
  const topItem = [...build.items].sort((a, b) => b.score - a.score)[0];
  return topItem ? [...abilityIds, topItem.item.id] : abilityIds;
}

/**
 * Build the JSON payload for the game-export tool. One category per build phase (Early/Mid/Late Game),
 * items in buy order. `ability_order` mirrors `build.abilityOrder` (already in recommended pick order).
 */
export function toGameBuildJson(build: Build, hero: Hero, opts?: { name?: string; description?: string; tags?: number[] }): GameBuildJson {
  const phases: Phase[] = ['early', 'mid', 'late'];
  const categories: GameBuildCategory[] = phases
    .map((phase) => {
      const item_ids = build.items
        .filter((b) => b.phase === phase)
        .sort((a, b) => a.order - b.order)
        .map((b) => b.item.id);
      const width = Math.max(1, item_ids.length) * ITEM_WIDTH;
      return { name: PHASE_LABEL[phase], description: '', width, height: ROW_HEIGHT, item_ids };
    })
    .filter((c) => c.item_ids.length > 0);

  return {
    hero_id: hero.id,
    hero_class_name: hero.class_name,
    name: opts?.name ?? defaultName(build, hero),
    description: opts?.description ?? defaultDescription(),
    categories,
    ability_order: build.abilityOrder.map((s) => ({ ability_id: s.ability.id, kind: s.kind })),
    tags: opts?.tags ?? relevantTags(build),
  };
}
