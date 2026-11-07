import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlight, reflow } from "../utils";

const marks = (text: string, query: string) => {
  const { container } = render(<p>{highlight(text, query)}</p>);
  return Array.from(container.querySelectorAll("mark")).map((m) => m.textContent);
};

describe("highlight", () => {
  it("skips stopwords and matches whole words only", () => {
    expect(marks("The controller uses the pump", "What does the controller use?")).toEqual(["controller", "uses"]);
    expect(marks("reuse of misuse", "use")).toEqual([]); // never inside another word
  });
  it("is plural tolerant in both directions and case-insensitive", () => {
    expect(marks("Sensor readings; two SENSORS", "sensors")).toEqual(["Sensor", "SENSORS"]);
  });
  it("is safe with regex characters and empty queries", () => {
    expect(marks("a (b) c++", "c++ (b)")).toEqual([]);
    expect(marks("anything", "the of")).toEqual([]);
  });
});

describe("reflow", () => {
  it("joins layout line breaks but keeps paragraph breaks", () => {
    expect(reflow("Soil moisture is\nmeasured here.\n\nNext paragraph")).toBe("Soil moisture is measured here.\n\nNext paragraph");
  });
});
