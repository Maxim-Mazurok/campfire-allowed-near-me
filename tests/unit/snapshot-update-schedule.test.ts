import { readFileSync } from "node:fs";
import { TZDate } from "@date-fns/tz";
import { CronExpressionParser } from "cron-parser";
import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_UPDATE_SCHEDULE_TOOLTIP } from "../../web/src/components/AppHeader";

const SYDNEY_TIMEZONE = "Australia/Sydney";

// July = AEST (standard, UTC+10), January = AEDT (daylight saving, UTC+11)
const AEST_REFERENCE_MONTH = 6;
const AEDT_REFERENCE_MONTH = 0;
const REFERENCE_YEAR = 2025;

const utcHourToSydneyFormatted = (
  utcHour: number,
  referenceMonth: number
): { displayHour: string; period: string } => {
  const utcDate = new TZDate(
    REFERENCE_YEAR, referenceMonth, 1, utcHour, 0, 0, "UTC"
  );
  const sydneyDate = utcDate.withTimeZone(SYDNEY_TIMEZONE);
  return {
    displayHour: format(sydneyDate, "h"),
    period: format(sydneyDate, "a"),
  };
};

const loadWorkflowContent = (): string => {
  const workflowPath = new URL(
    "../../.github/workflows/update-forest-data.yml",
    import.meta.url
  );
  return readFileSync(workflowPath, "utf-8");
};

const extractCronExpression = (workflowContent: string): string => {
  const cronMatch = workflowContent.match(
    /^\s+-\s+cron:\s*"([^"]+)"/m
  );
  if (!cronMatch) {
    throw new Error(
      "Could not find an uncommented cron expression in the workflow file"
    );
  }
  return cronMatch[1];
};

describe("snapshot update schedule tooltip", () => {
  const workflowContent = loadWorkflowContent();
  const cronExpression = extractCronExpression(workflowContent);
  const parsed = CronExpressionParser.parse(cronExpression);
  const utcHours: number[] = parsed.fields.hour.values;

  it("workflow cron schedule is uncommented and active", () => {
    expect(workflowContent).toMatch(/^\s+schedule:\s*$/m);
    expect(workflowContent).toMatch(/^\s+-\s+cron:\s*"/m);
  });

  it("cron runs exactly twice daily", () => {
    expect(utcHours).toHaveLength(2);
  });

  it("tooltip mentions Sydney time", () => {
    expect(SNAPSHOT_UPDATE_SCHEDULE_TOOLTIP.toLowerCase()).toContain(
      "sydney time"
    );
  });

  it("tooltip times match the cron schedule converted to Sydney timezone", () => {
    for (const utcHour of utcHours) {
      const aest = utcHourToSydneyFormatted(utcHour, AEST_REFERENCE_MONTH);
      const aedt = utcHourToSydneyFormatted(utcHour, AEDT_REFERENCE_MONTH);

      // Both ends of the DST range must fall in the same AM/PM period
      expect(aest.period).toBe(aedt.period);

      const [earlier, later] = [aest.displayHour, aedt.displayHour].sort(
        (a, b) => Number(a) - Number(b)
      );

      // Tooltip must contain e.g. "4–5 AM" or "4–5 PM"
      const expectedFragment = `${earlier}\u2013${later} ${aest.period}`;
      expect(SNAPSHOT_UPDATE_SCHEDULE_TOOLTIP).toContain(expectedFragment);
    }
  });

  it("workflow comment accurately describes the schedule in Sydney time", () => {
    const commentMatch = workflowContent.match(
      /^\s+#.*(?:twice daily|2x daily|two times).*$/im
    );
    expect(commentMatch).not.toBeNull();

    for (const utcHour of utcHours) {
      const aest = utcHourToSydneyFormatted(utcHour, AEST_REFERENCE_MONTH);
      const aedt = utcHourToSydneyFormatted(utcHour, AEDT_REFERENCE_MONTH);

      const [earlier, later] = [aest.displayHour, aedt.displayHour].sort(
        (a, b) => Number(a) - Number(b)
      );

      // Comment should mention the Sydney time range for each run
      const rangePattern = new RegExp(
        `${earlier}[\\s\\u2013-]+${later}\\s*${aest.period}`,
        "i"
      );
      expect(commentMatch![0]).toMatch(rangePattern);
    }
  });
});
