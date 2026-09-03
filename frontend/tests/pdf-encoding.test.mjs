import test from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { unzipSync, zipSync } from "fflate";

const reportNames = [
  "Learning_Gap_Report.pdf",
  "Study_Guide.pdf",
  "Worksheet.pdf",
  "Answer_Key.pdf",
  "Answer_Sheet.pdf",
];

function samplePdfBytes(name, iteration) {
  const pdf = new jsPDF({ compress: true });
  pdf.text(`${name} encoding check ${iteration}`, 12, 20);
  return new Uint8Array(pdf.output("arraybuffer"));
}

function assertPdf(bytes, name) {
  assert.ok(bytes.length > 5, `${name} is empty`);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-", `${name} does not contain a PDF signature`);
}

test("every downloadable report remains PDF-encoded across repeated ZIP generation", () => {
  for (let iteration = 1; iteration <= 20; iteration += 1) {
    const files = Object.fromEntries(reportNames.map(name => {
      const bytes = samplePdfBytes(name, iteration);
      assertPdf(bytes, name);
      return [name, bytes];
    }));
    const unpacked = unzipSync(zipSync(files, { level: 6 }));
    assert.deepEqual(Object.keys(unpacked).sort(), [...reportNames].sort());
    for (const [name, bytes] of Object.entries(unpacked)) assertPdf(bytes, name);
  }
});
