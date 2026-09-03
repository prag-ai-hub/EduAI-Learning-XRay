import { ocr as ocrViaProxy } from "./ai-proxy";
import { unzipSync } from "fflate";

export type TextDocument = { name: string; base64: string; mimeType: string };

function bytesFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function xmlToText(xml: string) {
  return xml
    .replace(/<\/(?:w:p|text:p|text:h)>/gi, "\n")
    .replace(/<w:tab\/>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rtfToText(rtf: string) {
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extension(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}

async function extractSpreadsheet(bytes: Uint8Array) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "array" });
  return workbook.SheetNames.map(name => `# ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n").trim();
}

/**
 * OCR through the Django proxy. The Mistral key lives there, not here.
 *
 * The file is sent as a base64 data URL rather than a fetchable address: it is
 * a student's answer sheet in private storage, and handing a provider a URL it
 * could fetch later is a different exposure from handing it bytes once.
 */
async function extractWithProxy(document: TextDocument, request: Request) {
  const dataUrl = `data:${document.mimeType || "application/octet-stream"};base64,${document.base64}`;
  const isPdf = document.mimeType === "application/pdf" || extension(document.name) === "pdf";
  const startedAt = Date.now();
  const { text } = await ocrViaProxy(request, { kind: isPdf ? "document" : "image", dataUrl });
  const ms = Date.now() - startedAt;
  if (!text.trim()) throw new Error(`No readable text was found in ${document.name}.`);
  return { text, ms, provider: "mistral" as const };
}

export async function extractDocumentText(document: TextDocument, request: Request) {
  const ext = extension(document.name);
  const bytes = bytesFromBase64(document.base64);
  const directText = document.mimeType.startsWith("text/") || ["md","markdown","txt","csv","tsv","json","xml","yaml","yml","html","htm","rtf"].includes(ext);
  if (directText) {
    const raw = decode(bytes);
    const text = ext === "rtf" ? rtfToText(raw) : raw.trim();
    if (!text) throw new Error(`No readable text was found in ${document.name}.`);
    return { text, ms: 0, provider: "local" as const };
  }
  if (ext === "docx" || ext === "odt") {
    const archive = unzipSync(bytes);
    const entry = ext === "docx" ? archive["word/document.xml"] : archive["content.xml"];
    if (!entry) throw new Error(`${document.name} does not contain a readable document body.`);
    const text = xmlToText(decode(entry));
    if (!text) throw new Error(`No readable text was found in ${document.name}.`);
    return { text, ms: 0, provider: "local" as const };
  }
  if (["xlsx","xls"].includes(ext)) {
    const text = await extractSpreadsheet(bytes);
    if (!text) throw new Error(`No readable cells were found in ${document.name}.`);
    return { text, ms: 0, provider: "local" as const };
  }
  return extractWithProxy(document, request);
}
