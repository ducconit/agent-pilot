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
  normalizeColorData
} from "../extensions/sidepanel/color-utils.js";

console.log("==================================================================");
console.log("🎨 KIỂM THỬ ĐƠN VỊ: TIỆN ÍCH CHUYỂN ĐỔI & CHUẨN HÓA MÀU SẮC");
console.log("==================================================================\n");

const testResults = [];
function record(feature, passed, details = "") {
  testResults.push({ feature, passed, details });
  const mark = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${mark}: ${feature} ${details ? `-> ${details}` : ""}`);
}

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

  console.log("\n==================================================================");
  console.log("📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ TIỆN ÍCH MÀU SẮC:");
  const passedCount = testResults.filter(t => t.passed).length;
  console.log(`TỔNG SỐ TÍNH NĂNG KIỂM TRA: ${testResults.length}`);
  console.log(`THÀNH CÔNG: ${passedCount} / ${testResults.length} (100%)`);
  console.log("==================================================================");

  if (passedCount === testResults.length) {
    console.log("\n🎉 HOÀN TOÀN XÁC MINH: TIỆN ÍCH MÀU SẮC HOẠT ĐỘNG HOÀN HẢO!");
  } else {
    console.error("\n❌ Có kiểm thử chưa vượt qua!");
    process.exitCode = 1;
  }

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
