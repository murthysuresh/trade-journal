"use client";
import { HoverHint } from "./ui/tooltip";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CalendarMonth } from "@luxalgo/journal-core";
import { cn, fmtMoney } from "@/lib/utils";
import { Pnl } from "./pnl";
import { MonetaryValue, usePrivacy } from "./privacy";
import type { CalendarPnlPoint } from "@/lib/calendar-insights";
import { CalendarDayPreview } from "./calendar-day-preview";

const compactFormatters = new Map<string, Intl.NumberFormat>();
const compactMoney = (value: number, currency: string) => {
  let formatter = compactFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
      signDisplay: "exceptZero",
    });
    compactFormatters.set(currency, formatter);
  }
  return formatter.format(value);
};

/**
 * The P&L calendar — an HTML grid, not a chart. Each traded day prints its
 * signed P&L and trade count; the background tint scales with magnitude
 * (lightness carries magnitude, which survives CVD; the number carries sign).
 */
export function CalendarPnl({
  calendar,
  currency = "USD",
  monetary = true,
  runningPnl,
  onDaySelect,
  selectedDate,
  itemNoun = "trade",
}: {
  calendar: CalendarMonth;
  currency?: string;
  monetary?: boolean;
  runningPnl?: Record<string, CalendarPnlPoint[]>;
  onDaySelect?: (date: string) => void;
  selectedDate?: string | null;
  itemNoun?: "trade" | "parent";
}) {
  const maxAbs = Math.max(
    1,
    ...calendar.weeks.flatMap((week) => week.days.map((day) => Math.abs(day?.netPnl ?? 0))),
  );
  return (
    <div className="journal-calendar min-w-0 w-full">
      <div className="journal-calendar-grid grid gap-1 text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div key={weekday} className="px-1 pb-1 text-muted-foreground">
            {weekday}
          </div>
        ))}
        <div className="journal-calendar-week-heading px-1 pb-1 text-right text-muted-foreground">
          Week
        </div>
        {calendar.weeks.map((week, weekIndex) => (
          <CalendarWeekRow
            key={weekIndex}
            week={week}
            maxAbs={maxAbs}
            currency={currency}
            monetary={monetary}
            runningPnl={runningPnl}
            onDaySelect={onDaySelect}
            selectedDate={selectedDate}
            itemNoun={itemNoun}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs sm:text-sm">
        <span className="text-muted-foreground">
          {calendar.tradingDays} trading days {monetary && <>· {calendar.winningDays} green</>}
        </span>
        <span>
          Month:{" "}
          {monetary ? (
            <Pnl value={calendar.monthNetPnl} currency={currency} className="font-semibold" />
          ) : (
            <span className="text-muted-foreground">Multiple currencies</span>
          )}
        </span>
      </div>
    </div>
  );
}

function CalendarWeekRow({
  week,
  maxAbs,
  currency,
  monetary,
  runningPnl,
  onDaySelect,
  selectedDate,
  itemNoun,
}: {
  week: CalendarMonth["weeks"][number];
  maxAbs: number;
  currency: string;
  monetary: boolean;
  runningPnl?: Record<string, CalendarPnlPoint[]>;
  onDaySelect?: (date: string) => void;
  selectedDate?: string | null;
  itemNoun: "trade" | "parent";
}) {
  const search = useSearchParams();
  const privacy = usePrivacy();
  return (
    <>
      {week.days.map((day, dayIndex) => {
        if (!day) return <div key={dayIndex} className="journal-calendar-day rounded-md" />;
        const traded = day.trades > 0;
        const intensity = traded ? 0.1 + 0.38 * (Math.abs(day.netPnl) / maxAbs) : 0;
        const performance = !monetary
          ? "neutral"
          : day.netPnl > 0
            ? "profit"
            : day.netPnl < 0
              ? "loss"
              : "neutral";
        const ariaLabel = `${day.date}, ${!monetary ? "Multiple currencies" : privacy ? "P&L hidden" : fmtMoney(day.netPnl, currency)}, ${day.trades} ${itemNoun}${day.trades === 1 ? "" : "s"}`;
        const className = cn(
          "journal-calendar-day journal-calendar-day-link min-w-0 rounded-md border",
          !traded && "border-transparent bg-muted/30",
          selectedDate === day.date && "ring-2 ring-brand ring-offset-2 ring-offset-background",
        );
        const style =
          traded && monetary
            ? {
                backgroundColor: `color-mix(in oklab, ${
                  performance === "profit"
                    ? "var(--profit-fill)"
                    : performance === "loss"
                      ? "var(--loss)"
                      : "var(--neutral-mid)"
                } ${Math.round(intensity * 100)}%, var(--card))`,
              }
            : undefined;
        const content = (
          <>
            <div className="text-muted-foreground">{Number(day.date.slice(8))}</div>
            {traded && (
              <>
                <div className="journal-calendar-full tnum font-medium">
                  {monetary ? <MonetaryValue>{fmtMoney(day.netPnl, currency)}</MonetaryValue> : "—"}
                </div>
                <div className="journal-calendar-compact tnum font-medium">
                  {monetary ? (
                    <MonetaryValue>{compactMoney(day.netPnl, currency)}</MonetaryValue>
                  ) : (
                    "—"
                  )}
                </div>
                <div className="journal-calendar-trades text-muted-foreground">
                  {day.trades} {itemNoun}
                  {day.trades === 1 ? "" : "s"}
                </div>
              </>
            )}
          </>
        );
        return (
          <HoverHint
            key={day.date}
            heading={day.date}
            content={
              runningPnl ? (
                <CalendarDayPreview
                  points={runningPnl[day.date] ?? []}
                  total={day.netPnl}
                  trades={day.trades}
                  currency={currency}
                  monetary={monetary}
                />
              ) : (
                `${!monetary ? "Multiple currencies" : privacy ? "P&L hidden" : fmtMoney(day.netPnl, currency)} · ${day.trades} ${itemNoun}${day.trades === 1 ? "" : "s"}`
              )
            }
          >
            {onDaySelect ? (
              <button
                type="button"
                aria-label={ariaLabel}
                aria-pressed={selectedDate === day.date}
                disabled={!traded}
                className={className}
                data-performance={performance}
                style={style}
                onClick={() => onDaySelect(day.date)}
              >
                {content}
              </button>
            ) : (
              <Link
                href={`/journal/${day.date}?${search}`}
                aria-label={ariaLabel}
                className={className}
                data-performance={performance}
                style={style}
              >
                {content}
              </Link>
            )}
          </HoverHint>
        );
      })}
      <div className="journal-calendar-week flex rounded-md bg-muted/40 p-1.5">
        <span className="journal-calendar-week-label text-muted-foreground">Week total</span>
        {week.weekTrades > 0 ? (
          <>
            {monetary && (
              <Pnl value={week.weekNetPnl} currency={currency} className="font-medium" />
            )}
            <span className="text-muted-foreground">
              {week.weekTrades} {itemNoun}
              {week.weekTrades === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </div>
    </>
  );
}
