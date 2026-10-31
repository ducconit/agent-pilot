#!/usr/bin/env node
/**
 * Agent Pilot - Side Panel Color Utilities Verification Test Suite
 * Tests hex parsing (3/4/6/8 digit), format conversion, and color normalization.
 */

import {
  hexToRgbNums,
  rgbToHex,
  rgbToHsl,
  rgbToOklch,
  rgbToRgba,
  normalizeColorData
} from "../../../extensions/sidepanel/color-utils.js";
import { SEPARATOR } from "../../../scripts/lib/config.mjs";
import { createRecorder } from "../../../scripts/lib/harness.mjs";

console.log(SEPARATOR);
console.log("🎨 KIỂM THỬ ĐƠN VỊ: TIỆN ÍCH CHUYỂN ĐỔI & CHUẨN HÓA MÀU SẮC");
console.log(`${SEPARATOR}\n`);

const recorder = createRecorder({
  title: "📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ TIỆN ÍCH MÀU SẮC:",
  successMessage: "\n🎉 HOÀN TOÀN XÁC MINH: TIỆN ÍCH MÀU SẮC HOẠT ĐỘNG HOÀN HẢO!",
  failureMessage: "\n❌ Có kiểm thử chưa vượt qua!"
});
const record = recorder.record;

try {
  // 1. 3-digit hex expands by doubling each nibble
  const hex3 = hexToRgbNums("#abc");
  record(
    "1. 3-digit HEX Parsing (#abc)",
    hex3.r === 170 && hex3.g === 187 && hex3.b === 204,
    `r=${hex3.r}, g=${hex3.g}, b=${hex3.b}`
  );

  // 2. 6-digit hex parsing
  const hex6 = hexToRgbNums("#aabbcc");
  record(
    "2. 6-digit HEX Parsing (#aabbcc)",
    hex6.r === 170 && hex6.g === 187 && hex6.b === 204,
    `r=${hex6.r}, g=${hex6.g}, b=${hex6.b}`
  );

  // 3. 4-digit hex expands to 8 and ignores alpha
  const hex4 = hexToRgbNums("#abcd");
  record(
    "3. 4-digit HEX Parsing & Alpha Ignored (#abcd)",
    hex4.r === 170 && hex4.g === 187 && hex4.b === 204,
    `r=${hex4.r}, g=${hex4.g}, b=${hex4.b}`
  );

  // 4. 8-digit hex ignores alpha channel
  const hex8 = hexToRgbNums("#aabbccdd");
  record(
    "4. 8-digit HEX Parsing & Alpha Ignored (#aabbccdd)",
    hex8.r === 170 && hex8.g === 187 && hex8.b === 204,
    `r=${hex8.r}, g=${hex8.g}, b=${hex8.b}`
  );

  // 5. Invalid input returns zeroed channels
  const hexBad = hexToRgbNums("#xyz");
  const hexShort = hexToRgbNums("#12");
  const hexEmpty = hexToRgbNums();
  const invalidSafe =
    hexBad.r === 0 && hexBad.g === 0 && hexBad.b === 0 &&
    hexShort.r === 0 && hexShort.g === 0 && hexShort.b === 0 &&
    hexEmpty.r === 0 && hexEmpty.g === 0 && hexEmpty.b === 0;
  record(
    "5. Invalid HEX Input Returns Zeros (#xyz / #12 / undefined)",
    invalidSafe,
    "Bad length and non-hex characters rejected"
  );

  // 6. rgbToHex emits UPPERCASE (aligned with eyedropper.js)
  const upper = rgbToHex(170, 187, 204);
  record(
    "6. rgbToHex UPPERCASE Output",
    upper === "#AABBCC",
    `value=${upper}`
  );

  // 7. rgbToHsl known value (pure red)
  const hslRed = rgbToHsl(255, 0, 0);
  record(
    "7. rgbToHsl Known Value (Pure Red)",
    hslRed === "hsl(0, 100%, 50%)",
    `value=${hslRed}`
  );

  // 8. rgbToOklch known value (pure red)
  const okRed = rgbToOklch(255, 0, 0);
  record(
    "8. rgbToOklch Known Value (Pure Red)",
    okRed === "oklch(62.8% 0.258 29.2)",
    `value=${okRed}`
  );

  // 9. rgbToOklch known value (black)
  const okBlack = rgbToOklch(0, 0, 0);
  record(
    "9. rgbToOklch Known Value (Black)",
    okBlack === "oklch(0.0% 0.000 0.0)",
    `value=${okBlack}`
  );

  // 10. rgbToOklch known value (white)
  const okWhite = rgbToOklch(255, 255, 255);
  record(
    "10. rgbToOklch Known Value (White)",
    okWhite === "oklch(100.0% 0.000 0.0)",
    `value=${okWhite}`
  );

  // 11. normalizeColorData derives r/g/b from hex when IPC payload omits them
  const normFast = normalizeColorData({
    hex: "#FF0000",
    rgb: "rgb(255, 0, 0)",
    rgba: "rgba(255, 0, 0, 1)",
    hsl: "hsl(0, 100%, 50%)",
    oklch: "oklch(62.8% 0.258 29.2)",
    timestamp: 1
  });
  record(
    "11. normalizeColorData Derives r/g/b From HEX",
    normFast && normFast.r === 255 && normFast.g === 0 && normFast.b === 0,
    `r=${normFast && normFast.r}, g=${normFast && normFast.g}, b=${normFast && normFast.b}`
  );

  // 12. normalizeColorData handles bare hex string
  const normString = normalizeColorData("#00ff00");
  record(
    "12. normalizeColorData Accepts HEX String",
    normString && normString.r === 0 && normString.g === 255 && normString.b === 0 && normString.hex === "#00FF00",
    `hex=${normString && normString.hex}`
  );

  // 13. normalizeColorData consistently emits UPPERCASE .hex
  const normLowerHex = normalizeColorData({ hex: "#aabbcc" });
  const normFastLower = normalizeColorData({
    hex: "#ff8800",
    rgb: "rgb(255, 136, 0)",
    rgba: "rgba(255, 136, 0, 1)",
    hsl: "hsl(32, 100%, 50%)",
    oklch: "oklch(75.0% 0.180 50.0)"
  });
  record(
    "13. normalizeColorData Consistently Emits UPPERCASE HEX",
    normLowerHex.hex === "#AABBCC" && normFastLower.hex === "#FF8800",
    `normLower=${normLowerHex.hex}, normFastLower=${normFastLower.hex}`
  );

  // 14. normalizeColorData handles NaN and out-of-range RGB values gracefully
  const normNan = normalizeColorData({ r: NaN, g: 0, b: 0 });
  const normClamped = normalizeColorData({ r: 350, g: -50, b: 128.4 });
  record(
    "14. normalizeColorData Handles NaN & Out-of-Range RGB Numbers",
    normNan && normNan.r === 0 && normNan.g === 0 && normNan.b === 0 && normNan.hex === "#000000" &&
    normClamped && normClamped.r === 255 && normClamped.g === 0 && normClamped.b === 128 && normClamped.hex === "#FF0080",
    `nanHex=${normNan && normNan.hex}, clampedHex=${normClamped && normClamped.hex}`
  );

  // 15. rgbToHex handles NaN, negative, and oversized numbers
  const hexNan = rgbToHex(NaN, -20, 300);
  record(
    "15. rgbToHex Robustness With NaN, Negative & Out-of-Range Inputs",
    hexNan === "#0000FF",
    `value=${hexNan}`
  );

  // 16. rgbToHsl, rgbToOklch, and rgbToRgba clamp NaN and out-of-range inputs
  const hslNan = rgbToHsl(NaN, -10, 300);
  const oklchNan = rgbToOklch(NaN, -10, 300);
  const rgbaNan = rgbToRgba(NaN, -10, 300, 2);
  record(
    "16. Format Converters (HSL, OKLCH, RGBA) Clamp NaN & Out-of-Range Inputs",
    hslNan === "hsl(240, 100%, 50%)" &&
    oklchNan === "oklch(45.2% 0.313 264.1)" &&
    rgbaNan === "rgba(0, 0, 255, 1)",
    `hsl=${hslNan}, oklch=${oklchNan}, rgba=${rgbaNan}`
  );

  recorder.summarize();
  recorder.exitIfFailed();

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
