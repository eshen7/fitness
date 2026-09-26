import { Card, EmptyState, Tag } from "@/components/ui";
import { formatPortion, mealSlotLabels } from "@/lib/labels";
import { groupBySentence, type MealGroup } from "@/lib/nutrition/queries";
import { EntryActions, SentenceActions } from "./entry-actions";

/**
 * The day, in the grain it was typed in.
 *
 * Meals hold sentences and sentences hold foods, which is three levels and looks
 * like one too many until the sentence is what the owner wants to act on: "repeat
 * yesterday's breakfast" and "that whole line was lunch, not dinner" are both
 * sentence-level, and only a wrong portion is food-level. So the sentence keeps its
 * own row with its own text, and it is also the visible proof of the phrase cache -
 * repeating one costs nothing.
 */
export function DayLog({
  meals,
  hasHistory,
}: {
  meals: MealGroup[];
  hasHistory: boolean;
}) {
  if (meals.length === 0) {
    return (
      <EmptyState title="Nothing logged today">
        {hasHistory
          ? "Type a sentence above. Anything eaten before resolves from the cache, so it costs nothing and gives the same numbers."
          : "Type what you ate in plain language. Each food is resolved once and cached, so the second time you eat it the numbers are identical and no estimate is made."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {meals.map((group) => (
        <Card key={group.meal}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-ink">
              {mealSlotLabels.of(group.meal)}
            </h3>
            <p className="tnum text-xs text-ink-faint">
              <span className="font-medium text-ink-muted">{group.totals.kcal} kcal</span>
              {` · P ${group.totals.proteinG} · C ${group.totals.carbsG} · F ${group.totals.fatG}`}
            </p>
          </div>

          <div className="mt-3 space-y-3">
            {groupBySentence(group.items).map((sentence) => (
              <div key={sentence.key}>
                {sentence.rawText ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    {/*
                      Truncated rather than wrapped, because the items below are the
                      substance and this is only the echo of what produced them. The
                      full sentence stays reachable through `title`, since a truncated
                      line the owner cannot read back is a line they cannot check.
                    */}
                    <p
                      title={sentence.rawText}
                      className="min-w-0 flex-1 truncate text-xs text-ink-faint italic"
                    >
                      “{sentence.rawText}”
                    </p>
                    <SentenceActions
                      entryId={sentence.items[0].id}
                      itemCount={sentence.items.length}
                    />
                  </div>
                ) : null}

                <ul className="mt-1.5 space-y-1.5">
                  {sentence.items.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-field border border-line bg-surface-sunken px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                            <span className="min-w-0 break-words">{item.name}</span>
                            {item.provenance === "owner" ? (
                              <Tag tone="cool">yours</Tag>
                            ) : null}
                            {item.suspectMacros ? (
                              <Tag tone="warn">macros disagree</Tag>
                            ) : null}
                          </p>
                          {/*
                            One span per figure, because `tnum` carries nowrap: on the
                            paragraph, "1.5 tablespoon · P 24.5 · C 33.5 · F 12.5 ·
                            fibre 3.1" runs off the side of the card rather than
                            wrapping. Per figure it can only break at a separator.
                          */}
                          <p className="mt-0.5 text-xs text-ink-faint">
                            {[
                              formatPortion(item.quantity, item.unit),
                              `P ${item.macros.proteinG}`,
                              `C ${item.macros.carbsG}`,
                              `F ${item.macros.fatG}`,
                              ...(item.macros.fiberG === null
                                ? []
                                : [`fibre ${item.macros.fiberG}`]),
                            ].map((part, i) => (
                              <span key={part}>
                                {i === 0 ? null : " · "}
                                <span className="tnum">{part}</span>
                              </span>
                            ))}
                          </p>
                        </div>
                        <p className="tnum shrink-0 text-sm font-medium text-ink">
                          {item.macros.kcal}
                          <span className="ml-1 text-xs font-normal text-ink-faint">
                            kcal
                          </span>
                        </p>
                      </div>
                      <EntryActions
                        entryId={item.id}
                        quantity={item.quantity}
                        unit={item.unit}
                        perUnit={item.perUnit}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
