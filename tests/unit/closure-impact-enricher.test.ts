import { describe, expect, it } from "vitest";
import { inferClosureStructuredImpactByRules } from "../../apps/api/src/services/closure-impact-enricher.js";

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
});
