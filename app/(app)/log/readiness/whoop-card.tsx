import { Button, Card, Tag } from "@/components/ui";
import { dayOf, formatDay, formatTime } from "@/lib/time";
import { whoopConfigured } from "@/lib/whoop/config";
import { getConnection } from "@/lib/whoop/tokens";
import { WhoopControls } from "./whoop-controls";

/**
 * The connection itself: connect, reconnect, sync, disconnect.
 *
 * It lives on the readiness screen rather than in a settings page because this is
 * the screen its data fills. When recovery is missing this morning, the question
 * is "is the device still connected", and the answer should be on the same screen
 * as the gap.
 */
export async function WhoopCard({
  status,
  reason,
}: {
  status?: string;
  reason?: string;
}) {
  if (!whoopConfigured()) {
    return (
      <Card className="mb-4">
        <h2 className="text-sm font-semibold text-ink">WHOOP</h2>
        <p className="mt-1.5 text-xs text-ink-faint">
          Not configured. Set <code className="text-ink-muted">WHOOP_CLIENT_ID</code>{" "}
          and <code className="text-ink-muted">WHOOP_CLIENT_SECRET</code>, with the
          redirect URI pointing at <code className="text-ink-muted">/api/whoop/callback</code>.
          Until then recovery, sleep and strain stay blank and the rest of the
          check-in works unchanged.
        </p>
      </Card>
    );
  }

  const connection = await getConnection();
  const stale = connection?.invalidatedAt ?? null;

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">WHOOP</h2>
        {connection ? (
          stale ? (
            <Tag tone="bad">reconnect</Tag>
          ) : (
            <Tag tone="accent">connected</Tag>
          )
        ) : (
          <Tag tone="cool">not connected</Tag>
        )}
      </div>

      {status === "connected" || status === "connected-empty" ? (
        <p className="mt-1.5 text-xs text-accent">
          Connected.{" "}
          {status === "connected-empty"
            ? "The first backfill returned nothing, which the nightly sync will retry."
            : "The last week has been pulled in."}
        </p>
      ) : null}

      {connection ? (
        <>
          <p className="mt-1.5 text-xs text-ink-faint">
            {stale ? (
              <>
                The token pair was retired and could not be refreshed
                {connection.invalidatedReason
                  ? `: ${connection.invalidatedReason}`
                  : ""}
                . Refreshing rotates both tokens at once, so there is nothing left
                to retry with and it has to be authorized again.
              </>
            ) : (
              <>
                Recovery, sleep and strain arrive on their own. Last refreshed{" "}
                {connection.lastRefreshedAt
                  ? // `dayOf`, not the UTC date: `formatTime` is already in the app's
                    // zone, so a refresh at 9pm eastern read "tomorrow at 21:07".
                    `${formatDay(dayOf(connection.lastRefreshedAt))} at ${formatTime(connection.lastRefreshedAt)}`
                  : "never"}
                .
              </>
            )}
          </p>
          {stale ? (
            <a href="/api/whoop/connect" className="mt-3 inline-block">
              <Button>Reconnect WHOOP</Button>
            </a>
          ) : (
            <WhoopControls />
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-ink-faint">
            Connecting fills recovery, HRV, resting heart rate, sleep and day strain
            every morning, so readiness stops depending on how diligently the form
            gets filled in. Jump height, tendon pain, RPE and bodyweight stay
            manual.
          </p>
          {/*
            The reason is carried through from the callback rather than swallowed.
            "Try again" is useless advice for a redirect URI that does not match
            the one registered with WHOOP, which is the failure that actually
            happens, and it says so in the reason.
          */}
          {status === "error" ? (
            <p className="mt-1.5 text-xs text-bad">
              The last attempt did not complete{reason ? `: ${reason}` : ""}.
            </p>
          ) : null}
          {/*
            A plain anchor, not a Link: the target is a route handler that
            redirects off-origin to WHOOP, which client navigation cannot follow.
          */}
          <a href="/api/whoop/connect" className="mt-3 inline-block">
            <Button>Connect WHOOP</Button>
          </a>
        </>
      )}
    </Card>
  );
}
