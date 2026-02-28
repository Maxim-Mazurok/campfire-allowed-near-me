import { describe, expect, it } from "vitest";
import { inferClosureStructuredImpactByRules } from "../../pipeline/services/closure-impact-enricher.js";

describe("inferClosureStructuredImpactByRules", () => {
  it("marks camping and access as closed for clear full-closure notices", () => {
    const result = inferClosureStructuredImpactByRules({
      title: "Avon River State Forest closed",
      detailText: "Please note that Avon River State Forest is closed until further notice.",
      status: "CLOSED"
    });

    expect(result.campingImpact).toBe("CLOSED");
    expect(result.access2wdImpact).toBe("CLOSED");
    expect(result.access4wdImpact).toBe("CLOSED");
    expect(result.confidence).toBe("HIGH");
  });

  it("keeps camping open while flagging access restrictions when roads are closed", () => {
    const result = inferClosureStructuredImpactByRules({
      title: "Bago State Forest: Sections of plantations closed",
      detailText:
        "Camping areas at Blowering dam are open. Main access roads to plantations remain closed.",
      status: "PARTIAL"
    });

    expect(result.campingImpact).toBe("NONE");
    expect(result.access2wdImpact).toBe("RESTRICTED");
    expect(result.access4wdImpact).toBe("RESTRICTED");
  });

  it("marks advisory impacts for event notices that keep forests open", () => {
    const result = inferClosureStructuredImpactByRules({
      title: "Wingello State Forest: Large community event",
      detailText:
        "The forest will remain open; however, it is expected to be extremely busy. Visitors are encouraged to plan ahead.",
      status: "NOTICE"
    });

    expect(result.campingImpact).toBe("ADVISORY");
    expect(result.access2wdImpact).toBe("NONE");
    expect(result.access4wdImpact).toBe("NONE");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("does not produce HIGH confidence for walk/feature closures classified as PARTIAL", () => {
    const result = inferClosureStructuredImpactByRules({
      title: "Wang Wauk State Forests: Wootton historic railway walk closed",
      detailText:
        "Please note that the Wootton Historic Railway Walk and Sam's Camp will be closed for public use from Monday 9 December until further notice. This is to ensure public safety while Forestry Corporation staff undertake routine maintenance activities. The walk will be re-opened upon completion of the maintenance work.",
      status: "PARTIAL"
    });

    expect(result.confidence).not.toBe("HIGH");
    expect(result.source).toBe("RULES");
    // Detail text mentions "Camp...closed" so camping impact is detected,
    // but crucially this is NOT a full-forest closure (HIGH + all CLOSED).
    expect(result.campingImpact).toBe("CLOSED");
    expect(result.access2wdImpact).not.toBe("CLOSED");
    expect(result.access4wdImpact).not.toBe("CLOSED");
  });
});
