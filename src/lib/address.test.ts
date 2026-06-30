import { describe, it, expect } from "vitest";
import { parseHomeAddress, splitTrailingHouseNumber, effectiveHomeParts } from "@/lib/address";

describe("parseHomeAddress", () => {
  it("splits the operator's blob into street / village / postal", () => {
    const r = parseHomeAddress("ул. Шипка 6  с. Ловско обл. Разград 7291");
    expect(r.street).toBe("ул. Шипка");
    expect(r.street_number).toBe("6");
    expect(r.city).toBe("с. Ловско");
    expect(r.postal_code).toBe("7291");
    // Region is derived, never stored in a field.
    expect(`${r.quarter}${r.block}${r.entry}`).toBe("");
  });

  it("extracts quarter + building parts for a town address", () => {
    const r = parseHomeAddress("гр. София, ж.к. Младост бл. 5 вх. Б ет. 3 ап. 12, 1715");
    expect(r.city).toBe("гр. София");
    expect(r.quarter).toBe("ж.к. Младост");
    expect(r.block).toBe("5");
    expect(r.entry).toBe("Б");
    expect(r.floor).toBe("3");
    expect(r.apartment).toBe("12");
    expect(r.postal_code).toBe("1715");
  });

  it("prefers a clean city argument over a settlement mined from the blob", () => {
    const r = parseHomeAddress("ул. Раковски 12 гр. Пловдив", "Пловдив");
    expect(r.city).toBe("Пловдив");
    expect(r.street).toBe("ул. Раковски");
    expect(r.street_number).toBe("12");
  });

  it("splits a packed quarter+building blob with no city/street (the жк case)", () => {
    const r = parseHomeAddress("жк Тракия, бл 183, вх Г, ет. 4, ап 12 сем. Колеви");
    expect(r.quarter).toBe("жк Тракия");
    expect(r.block).toBe("183");
    expect(r.entry).toBe("Г");
    expect(r.floor).toBe("4");
    expect(r.apartment).toBe("12");
    // No real street or city in the source — the family name must not become street.
    expect(r.street).toBe("");
    expect(r.city).toBe("");
  });

  it("keeps the city but pulls the quarter out of '<city> жк <name>'", () => {
    const r = parseHomeAddress("Гр. Пловдив жк Тракия");
    expect(r.city).toBe("Гр. Пловдив");
    expect(r.quarter).toBe("жк Тракия");
  });

  it("does NOT parse a courier-office blob (the courier tab owns it)", () => {
    const r = parseHomeAddress("Офис на Еконт, кв. Лозенец");
    expect(r.street).toBe("");
    expect(r.quarter).toBe("");
    expect(r.city).toBe("");
  });

  it("returns empty parts for empty input", () => {
    const r = parseHomeAddress("");
    expect(r).toEqual({
      quarter: "", street: "", street_number: "", block: "", entry: "",
      floor: "", apartment: "", city: "", postal_code: "",
    });
  });
});

describe("splitTrailingHouseNumber", () => {
  it("moves a number stuck in the street into street_number", () => {
    const r = splitTrailingHouseNumber({ street: "Гоце Делчев 18", street_number: "" });
    expect(r.street).toBe("Гоце Делчев");
    expect(r.street_number).toBe("18");
  });

  it("handles a comma before the number the same way", () => {
    const r = splitTrailingHouseNumber({ street: "Гоце делчев, 18", street_number: "" });
    expect(r.street).toBe("Гоце делчев");
    expect(r.street_number).toBe("18");
  });

  it("splits a № / No marker too", () => {
    expect(splitTrailingHouseNumber({ street: "Шипка № 6", street_number: "" }).street_number).toBe("6");
    expect(splitTrailingHouseNumber({ street: "Шипка No 6", street_number: "" }).street_number).toBe("6");
  });

  it("keeps a trailing letter on the number (18А)", () => {
    const r = splitTrailingHouseNumber({ street: "Иван Вазов 18А", street_number: "" });
    expect(r.street).toBe("Иван Вазов");
    expect(r.street_number).toBe("18А");
  });

  it("never clobbers a number the agent already put in its own field", () => {
    const r = splitTrailingHouseNumber({ street: "Гоце Делчев 18", street_number: "20" });
    expect(r.street).toBe("Гоце Делчев 18");
    expect(r.street_number).toBe("20");
  });

  it("leaves a numeric-name / leading-number street intact", () => {
    expect(splitTrailingHouseNumber({ street: "ул. 3-ти март", street_number: "" }).street_number).toBe("");
    expect(splitTrailingHouseNumber({ street: "8", street_number: "" }).street_number).toBe("");
  });

  it("is a no-op for an empty street", () => {
    const r = splitTrailingHouseNumber({ street: "", street_number: "" });
    expect(r.street).toBe("");
    expect(r.street_number).toBe("");
  });
});

describe("effectiveHomeParts", () => {
  it("prefers structured columns and splits a number out of street", () => {
    const r = effectiveHomeParts({ street: "Гоце Делчев 18", customer_city: "София", postal_code: "1000" });
    expect(r.street).toBe("Гоце Делчев");
    expect(r.street_number).toBe("18");
    expect(r.city).toBe("София");
    expect(r.postal_code).toBe("1000");
  });

  it("keeps an already-split structured address as-is", () => {
    const r = effectiveHomeParts({ street: "Шипка", street_number: "6", block: "12" });
    expect(r.street).toBe("Шипка");
    expect(r.street_number).toBe("6");
    expect(r.block).toBe("12");
  });

  it("parses a legacy blob-only row (no structured columns)", () => {
    const r = effectiveHomeParts({ customer_address: "ул. Раковски 12", customer_city: "Пловдив" });
    expect(r.street).toBe("ул. Раковски");
    expect(r.street_number).toBe("12");
    expect(r.city).toBe("Пловдив");
  });
});
