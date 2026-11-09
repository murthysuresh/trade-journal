"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import {
  chartWindowPreference,
  hoverDetailsPreference,
  V5_CHART_WINDOW_EVENT,
  V5_CHART_WINDOW_STORAGE_KEY,
  V5_DEFAULT_CHART_WINDOW_PERCENT,
  V5_HOVER_DETAILS_EVENT,
  V5_HOVER_DETAILS_STORAGE_KEY,
} from "@/lib/v5-chart-ui";

const store = (key: string, value: string, eventName: string) => {
  try {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event(eventName));
  } catch {
    // Controls remain usable for this page when browser storage is unavailable.
  }
};

export function V5ChartSettings() {
  const [windowPercent, setWindowPercent] = useState(V5_DEFAULT_CHART_WINDOW_PERCENT);
  const [hoverDetails, setHoverDetails] = useState(false);

  useEffect(() => {
    try {
      setWindowPercent(chartWindowPreference(localStorage.getItem(V5_CHART_WINDOW_STORAGE_KEY)));
      setHoverDetails(hoverDetailsPreference(localStorage.getItem(V5_HOVER_DETAILS_STORAGE_KEY)));
    } catch {
      setWindowPercent(V5_DEFAULT_CHART_WINDOW_PERCENT);
      setHoverDetails(false);
    }
  }, []);

  const updateWindow = (value: number) => {
    const next = chartWindowPreference(String(value));
    setWindowPercent(next);
    store(V5_CHART_WINDOW_STORAGE_KEY, String(next), V5_CHART_WINDOW_EVENT);
  };
  const updateHoverDetails = (value: boolean) => {
    setHoverDetails(value);
    store(V5_HOVER_DETAILS_STORAGE_KEY, String(value), V5_HOVER_DETAILS_EVENT);
  };
  const reset = () => {
    updateWindow(V5_DEFAULT_CHART_WINDOW_PERCENT);
    updateHoverDetails(false);
  };

  return (
    <Card id="v5-chart-preferences" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Certified V5 charts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="v5-chart-window">Default timeline window</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Smaller values open charts more tightly zoomed in.
              </p>
            </div>
            <output
              htmlFor="v5-chart-window"
              className="min-w-12 rounded-md border bg-muted/40 px-2 py-1 text-center text-sm font-medium"
            >
              {windowPercent}%
            </output>
          </div>
          <input
            id="v5-chart-window"
            aria-label="Default V5 chart timeline window"
            type="range"
            min={5}
            max={100}
            step={1}
            value={windowPercent}
            onChange={(event) => updateWindow(Number(event.currentTarget.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>5% · closer</span>
            <span>100% · full timeline</span>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox
            id="v5-hover-details"
            checked={hoverDetails}
            onCheckedChange={(checked) => updateHoverDetails(checked === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="v5-hover-details" className="cursor-pointer">
              Show hover details by default
            </Label>
            <p className="text-xs text-muted-foreground">
              Display the full ECharts tooltip while moving across a chart. This is Off by default.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Saved in this browser and applied to every certified V5 chart.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Reset chart defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
