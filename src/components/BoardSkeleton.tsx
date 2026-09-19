import { Skeleton } from './ui/skeleton';

// Same frame and rows as the real board, so the first paint holds the space the build will take.
export function BoardSkeleton() {
  return (
    <div className="board" aria-hidden="true">
      {[6, 10, 5].map((count, row) => (
        <div className="row" key={row}>
          <div className="row-head">
            <Skeleton className="sk-head" />
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
