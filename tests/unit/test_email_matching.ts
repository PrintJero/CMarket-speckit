import { describe, expect, it } from "vitest";
import { emailsMatch, isValidEmail, normalizeEmail } from "@/lib/validation/email";

describe("normalizeEmail", () => {
  it("lowercases the whole address", () => {
    expect(normalizeEmail("Name@Example.COM")).toBe("name@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  name@example.com  ")).toBe("name@example.com");
  });
});

describe("emailsMatch (FR-017)", () => {
  it("matches addresses that differ only by case", () => {
    expect(emailsMatch("Person@Example.com", "person@example.com")).toBe(true);
  });

  it("does not match genuinely different addresses", () => {
    expect(emailsMatch("person@example.com", "other@example.com")).toBe(false);
  });

  it("does NOT apply Gmail-style dot canonicalization", () => {
    expect(emailsMatch("n.a.m.e@example.com", "name@example.com")).toBe(false);
  });

  it("does NOT apply +tag canonicalization", () => {
    expect(emailsMatch("name+tag@example.com", "name@example.com")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a syntactically valid address", () => {
    expect(isValidEmail("person@example.com")).toBe(true);
  });

  it("rejects an address with no @", () => {
    expect(isValidEmail("person.example.com")).toBe(false);
  });

  it("rejects an address with no domain", () => {
    expect(isValidEmail("person@")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });
});
