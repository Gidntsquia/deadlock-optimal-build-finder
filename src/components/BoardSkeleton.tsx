import { Skeleton } from './ui/skeleton';

// Shaped like the real board (`.board` > 3x `.phase` > `.tiles` grid) so the first paint reserves
// the same space the real build occupies instead of a bare "Loading…" line that collapses layout.
export function BoardSkeleton() {
  return (
    <div className="board board-skeleton" aria-hidden="true">
      <div className="board-head">
        <Skeleton className="sk-title" />
      </div>
      {[8, 8, 6].map((count, phase) => (
        <div className="phase" key={phase}>
          <div className="phase-head">
            <Skeleton className="sk-phase-label" />
          </div>
          <div className="tiles">
            {Array.from({ length: count }, (_, i) => (
              <Skeleton className="sk-tile" key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
