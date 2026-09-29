import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { loadGuideState } from "@/lib/guide/queries";
import { setupProgress, STEP_COPY, stepDone, type SetupStep } from "@/lib/guide/steps";

export const metadata = { title: "Getting started" };

/** What each setup step is for, in one or two plain sentences. */
const SETUP_WHY: Record<SetupStep, ReactNode> = {
  profile: (
    <>
      Tick every piece of equipment you can use and the weekdays you train. The
      planner only picks exercises your equipment allows, so leaving equipment
      empty means bodyweight only, and leaving the days empty lets the planner
      choose them. Saving the profile completes this step.
    </>
  ),
  bodyweight: (
    <>
      On <Strong>Log, Body</Strong>, first thing in the morning. Food targets and
      relative strength both start from it.
    </>
  ),
  vertical: (
    <>
      On <Strong>Log, Test</Strong>, three attempts in one sitting. Progress then shows
      your best and how much a single test wobbles.
    </>
  ),
  food: (
    <>
      On <Strong>Food</Strong>, pick gain, maintain or cut. The targets start from a
      default maintenance and switch to one measured from your own food log and
      weigh-ins after five weeks of logging food on at least four days a week.
    </>
  ),
  block: (
    <>
      On <Strong>Plan</Strong>, say how many weeks and what the block is for. The AI
      proposes the block; nothing is written until you accept it.
    </>
  ),
  week: (
    <>
      Still on <Strong>Plan</Strong>, generate the block&apos;s first week and accept
      it. Its sessions then show up on Today.
    </>
  ),
};

/**
 * The getting-started guide: setup, the daily loop, the weekly loop, and how to
 * read what the AI proposes.
 *
 * Setup is a live checklist read from the database, so a step shows as done
 * because its row exists; the loops are fixed text, because they describe habits
 * rather than state. Today offers this page until setup is done or the prompt is
 * hidden, and links to it from its header either way.
 */
export default async function GuidePage() {
  const { facts } = await loadGuideState();
  const progress = setupProgress(facts);

  return (
    <>
      <header className="mb-6">
        <Link
          href="/today"
          className="-my-2 inline-flex min-h-11 items-center text-sm text-ink-faint hover:text-ink-muted"
        >
          ← Today
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Getting started</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Set up once, then a daily habit and a weekly one.
        </p>
      </header>

      <div className="space-y-5">
        <Section
          title="1. One-time setup"
          aside={
            <span className="tnum text-xs text-ink-faint">
              {progress.done} of {progress.total} done
            </span>
          }
        >
          <ol className="space-y-4">
            {(Object.keys(STEP_COPY) as SetupStep[]).map((step, index) => {
              const done = stepDone(step, facts);
              return (
                <li key={step} className="flex gap-3">
                  <Marker done={done}>{index + 1}</Marker>
                  <div className="min-w-0">
                    <Link
                      href={STEP_COPY[step].href}
                      className={`-my-2 inline-flex min-h-11 items-center text-sm font-medium underline-offset-2 hover:underline ${
                        done ? "text-ink-muted" : "text-accent"
                      }`}
                    >
                      {STEP_COPY[step].title}
                      <span aria-hidden className="ml-1">→</span>
                    </Link>
                    {done ? <span className="sr-only"> (done)</span> : null}
                    <p className="text-sm text-ink-faint">{SETUP_WHY[step]}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 rounded-field border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            <Strong>A sore tendon?</Strong> Log it on{" "}
            <InlineLink href="/log/tendon">Log, Tendon</InlineLink> before declaring a
            block: pain from 0 to 10 in the morning, during and after, and its rehab
            phase. While a site is in phase 1 or 2, every exercise that loads it is
            left out of the plan, apart from the rehab exercises for that phase.
          </p>
        </Section>

        <Section title="2. Every day">
          <Steps>
            <Step title="Check in">
              On <InlineLink href="/log/readiness">Log, Readiness</InlineLink>, rate
              soreness by area and motivation. With WHOOP connected, recovery and sleep
              fill in on their own.
            </Step>
            <Step title="Open Today">
              It shows the planned session, what each exercise is for, and why this
              week looks the way it does. On a rest day it says when the next session
              is.
            </Step>
            <Step title="Log the session">
              Press <Strong>Log this session</Strong>. The logger walks through the
              plan: pick an exercise, enter reps, load and RPE, rate the rep quality
              from 1 to 5, and press <Strong>Log set</Strong>. The next set starts
              from what you just did. A load written as a percentage of your max
              needs a max on record: a heavy set of that lift, 1 to 10 reps with a
              load, or a tested max on its library page.
            </Step>
            <Step title="Finish">
              Pick how hard the whole session felt and press{" "}
              <Strong>Finish session</Strong>. Afterwards the AI may save a few
              remembered facts from it, which later plans take into account.
            </Step>
            <Step title="Log food">
              On <InlineLink href="/nutrition">Food</InlineLink>, type what you ate in
              plain words. It is split into items and counted against your targets.
              Four days a week or more is what lets the targets measure your
              maintenance.
            </Step>
            <Step title="Log sore tendons">
              Once a day, for any site that hurts, on Log, Tendon.
            </Step>
          </Steps>
        </Section>

        <Section title="3. Every week">
          <Steps>
            <Step title="Weigh in a few times">
              The trend needs four readings across three weeks before it states a
              rate, and the food targets follow the trend.
            </Step>
            <Step title="Re-test your jump">
              About once a week, three attempts per test. A drop during a hard block is
              expected and is marked that way on Progress: the rebound comes with the
              lighter weeks.
            </Step>
            <Step title="Generate next week">
              On <InlineLink href="/plan">Plan</InlineLink>, near the end of the week.
              The AI proposes it inside the current block; review it as below.
            </Step>
            <Step title="Refresh what the numbers say">
              On Plan, open <Strong>Memory</Strong> and press{" "}
              <Strong>Recompute</Strong>. Expect little for the first several weeks:
              most statements need eight or more data points.
            </Step>
            <Step title="Close the block">
              When its weeks are done, end it on Plan and declare the next one.
            </Step>
          </Steps>
        </Section>

        <Section title="4. Reviewing what the AI proposes">
          <p className="text-sm text-ink-muted">
            The AI never changes your plan on its own. Every block and every week
            arrives as a proposal, and nothing is written until you accept it.
          </p>
          <Steps className="mt-4">
            <Step title="Read the verdict first">
              Every proposal is checked against the training rules before you see it.{" "}
              <Strong>Gate passed</Strong> means it broke none. A red tag means it
              broke some, and each broken rule is spelled out underneath.
            </Step>
            <Step title="A refused block cannot be accepted">
              If no attempt passed, Accept stays off. Reject it, fix what the messages
              name, and declare again. When they name missing equipment or training
              days, the fix is on your profile.
            </Step>
            <Step title="Check three things on a week">
              No sore tendon is loaded, the heavy sessions land on the days you
              actually train, and the loads look right to you.
            </Step>
            <Step title="Edit, regenerate or reject">
              <Strong>Edit</Strong> changes a week before you accept it: move a
              session, drop one, or drop an exercise. <Strong>Regenerate</Strong> asks
              again and replaces the proposal. <Strong>Reject</Strong> throws it away and
              needs a short reason, which becomes the strongest steer for the next
              generation.
            </Step>
            <Step title="A fallback week is a stopgap">
              If the AI cannot produce a week that passes, you get a fallback: your
              last session of each kind at reduced load. It keeps training moving, but
              a new week is better once whatever blocked it is fixed.
            </Step>
            <Step title="See what the model was told">
              <Strong>What the model saw</Strong>, at the bottom of every proposal, is
              exactly what it was given. If a plan looks wrong, the reason is usually
              there.
            </Step>
          </Steps>
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {aside}
        </div>
        {children}
      </section>
    </Card>
  );
}

function Steps({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ol className={`space-y-3 ${className}`}>{children}</ol>;
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-sm text-ink-faint">{children}</p>
    </li>
  );
}

/** A step number, or a tick once the step is done. */
function Marker({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
        done ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-muted"
      }`}
    >
      {done ? "✓" : children}
    </span>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink-muted">{children}</span>;
}
