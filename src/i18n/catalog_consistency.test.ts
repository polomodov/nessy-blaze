import { describe, expect, it } from "vitest";
import { en } from "./messages/en";
import { ru } from "./messages/ru";

describe("i18n catalog consistency", () => {
  it("keeps identical key sets for en and ru", () => {
    const enKeys = Object.keys(en).sort();
    const ruKeys = Object.keys(ru).sort();

    expect(ruKeys).toEqual(enKeys);
  });
});
