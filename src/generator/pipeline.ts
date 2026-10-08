// Which heroes build with the v2 generator (docs/build-v2.md). Every other hero keeps the v1 path, unchanged.
export const V2_HEROES: Record<number, 'v2'> = { 1: 'v2' };
export const usesV2 = (heroId: number) => V2_HEROES[heroId] === 'v2';
