import type { Build } from '../types';
import { consensusThreshold, type PanelValidation } from '../validation/heldout';
import { fmtSouls } from '../text';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog';

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const PHASE = { early: 'Early', mid: 'Mid', late: 'Late' } as const;

// The one place numbers live: where the build comes from, how it compares to top players, and the per-item figures.
export function Details({
  build,
  panel,
  heroName,
  windowDays,
  fetchedDate,
}: {
  build: Build;
  panel: PanelValidation | null;
  heroName: string;
  windowDays?: number;
  fetchedDate: string | null;
}) {
  const reps = panel?.players.length ?? 0;
  const need = consensusThreshold(reps);
  const pop = build.population;
  const support = build.abilityOrderSupport;
  return (
    <Dialog>
      <DialogTrigger className="pill quiet details-btn">Details</DialogTrigger>
      <DialogContent className="sheet sheet-content wide details max-[899px]:translate-none" aria-describedby={undefined}>
        <DialogTitle asChild>
          <h2 className="sheet-title">
            {heroName} - {build.name}
          </h2>
        </DialogTitle>
        <p>{build.tagline}</p>
        <p className="source">
          {pop.kind === 'top'
            ? `From ${pop.matches.toLocaleString()} high-rank matches (Phantom and above).`
            : `From ${pop.matches.toLocaleString()} matches, all ranks (not enough high-rank games for this hero).`}{' '}
          {windowDays ? `Last ${windowDays} days` : ''}
          {fetchedDate ? `, data from ${fetchedDate}.` : ''}
        </p>
        <p>
          {build.items.length} items, <span className="souls">{fmtSouls(build.totalCost)}</span>
        </p>

        {panel && reps > 0 && (
          <>
            <h3>Validation vs. top players</h3>
            <div className="big agreement">
              {pct(panel.agreement)} match with {reps} top {heroName} {reps === 1 ? 'player' : 'players'}
            </div>
            {panel.missingConsensus.length > 0 && (
              <p>
                Not in this build:{' '}
                {panel.missingConsensus.map((c) => `${c.item.name} (${c.reps} of ${reps} players, ${pct(c.frequency)} of their games)`).join(', ')}
              </p>
            )}
            <div className="details-scroll">
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Games (wins)</th>
                    <th>Lifetime</th>
                    <th>Agree</th>
                    <th>Core</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.players.map((p) => (
                    <tr key={p.set.account_id}>
                      <td>{p.set.player}</td>
                      <td>
                        {p.core.matches} ({p.core.wins})
                      </td>
                      <td>{p.set.selection?.total_hero_matches ?? '-'}</td>
                      <td>{pct(p.validation.agreement)}</td>
                      <td>
                        {p.validation.sharedCount}/{p.core.core.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              A player's core set is every item they bought in 30% or more of their sampled games (wins count 1.5x). Match is the average over players
              {reps > 1 ? ', weighted by how representative each player is' : ''}. The build is not made from this data. It is only checked against it.
            </p>
          </>
        )}

        <h3>Ability order</h3>
        <p className="ability-support">
          {support
            ? `Most successful sequence in ${pop.abilitySequenceKind === 'top' ? 'high-rank' : 'all-rank'} data: ${support.matches.toLocaleString()} matches, ${pct(support.winRate, 1)} win rate.`
            : 'No sequence data. Default unlock order.'}
        </p>

        <h3>Items</h3>
        <div className="details-scroll">
          <table className="item-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Buy</th>
                <th>Phase</th>
                <th>Cost</th>
                <th>Total</th>
                <th>Bought</th>
                <th>Win rate</th>
                <th>Score</th>
                {reps > 0 && <th>Core</th>}
              </tr>
            </thead>
            <tbody>
              {build.items.map((b) => {
                const core = (panel?.consensusBadges[b.item.id] ?? 0) >= need;
                return (
                  <tr key={b.item.id} title={b.reasons.join('; ')} data-core={reps > 0 ? String(core) : undefined}>
                    <td>
                      {b.item.name}
                      {b.upgradesFrom ? ` (from ${b.upgradesFrom.name})` : ''}
                    </td>
                    <td>{b.order}</td>
                    <td>{PHASE[b.phase]}</td>
                    <td>{fmtSouls(b.paidCost)}</td>
                    <td>{fmtSouls(b.runningTotal)}</td>
                    <td>{pct(b.usageRate)}</td>
                    <td>{pct(b.winRate, 1)}</td>
                    <td>{b.score.toFixed(2)}</td>
                    {reps > 0 && (
                      <td>
                        {panel?.consensusBadges[b.item.id] ?? 0}/{reps}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          Score ranks an item against the other choices for that buy step, from its win rate and how often it is bought.
          {reps > 0 ? ` Core is how many of the top players have the item in their core set (${need} of ${reps} marks it core).` : ''}
        </p>
        <p>
          Data from <a href="https://deadlock-api.com">deadlock-api.com</a>. How builds are put together:{' '}
          <a href="https://github.com/Gidntsquia/deadlock-optimal-build-finder#readme">README</a>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
