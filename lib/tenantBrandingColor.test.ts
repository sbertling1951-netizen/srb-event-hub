import assert from "node:assert/strict";
import { test } from "node:test";

import {
  brandColorErrorMessage,
  isValidBrandColor,
} from "@/lib/tenantBrandingColor";

test("blank / whitespace / nullish values are valid (fall back to neutral default)", () => {
  for (const value of ["", "   ", "\t", null, undefined]) {
    assert.equal(isValidBrandColor(value), true, `blank: ${JSON.stringify(value)}`);
  }
});

test("hex forms #rgb / #rgba / #rrggbb / #rrggbbaa are valid", () => {
  for (const value of [
    "#fff",
    "#ffff",
    "#0af",
    "#112233",
    "#11223344",
    "#AABBCC",
    "  #123456  ",
  ]) {
    assert.equal(isValidBrandColor(value), true, value);
  }
});

test("rgb()/rgba()/hsl()/hsla() functional forms are valid", () => {
  for (const value of [
    "rgb(0,0,0)",
    "rgb(255, 255, 255)",
    "rgba(0, 0, 0, 0.5)",
    "rgba(10,20,30,1)",
    "hsl(210, 50%, 50%)",
    "hsla(210, 50%, 50%, 0.4)",
    "hsl(210deg, 50%, 50%)",
    "rgb(10%, 20%, 30%)",
  ]) {
    assert.equal(isValidBrandColor(value), true, value);
  }
});

test("representative CSS named colors are valid, case-insensitively", () => {
  for (const value of [
    "red",
    "blue",
    "black",
    "white",
    "rebeccapurple",
    "CornflowerBlue",
    "TRANSPARENT",
    "currentColor",
  ]) {
    assert.equal(isValidBrandColor(value), true, value);
  }
});

test("malformed and injection-style values are rejected", () => {
  for (const value of [
    "not-a-color",
    "totallyfakecolorname",
    "#12",
    "#12345",
    "#1234567",
    "#gggggg",
    "rgb(",
    "rgb()",
    "rgb(0,0)",
    "hsl(1, 2)",
    "rgba(0,0,0,)",
    "red; background: url(x)",
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "expression(alert(1))",
    "url(https://evil.example/x.png)",
  ]) {
    assert.equal(isValidBrandColor(value), false, value);
  }
});

test("the error message names the field and the accepted forms", () => {
  const message = brandColorErrorMessage("Primary color");
  assert.match(message, /^Primary color/);
  assert.match(message, /hex/i);
  assert.match(message, /rgb\(\)/i);
  assert.match(message, /blank/i);
});
