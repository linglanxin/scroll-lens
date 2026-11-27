import type { AppMode } from "../../types/api";

export const NOVEL_EXTENSIONS = [
  ".txt",
  ".epub",
  ".mobi",
  ".azw3",
  ".azw",
  ".fb2",
  ".pdf",
  ".docx",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".zip",
] as const;

export const DOC_EXTENSIONS = [".pdf", ".pptx", ".docx", ".md", ".txt"] as const;

export const NOVEL_ACCEPT = NOVEL_EXTENSIONS.join(",");
export const DOC_ACCEPT = DOC_EXTENSIONS.join(",");

export const NOVEL_FORMAT_BADGES = [
  "TXT",
  "EPUB",
  "MOBI",
  "AZW3",
  "FB2",
  "PDF",
  "DOCX",
  "MD",
  "HTML",
  "ZIP",
] as const;

export const DOC_FORMAT_BADGES = ["PDF", "PPTX", "DOCX", "MD", "TXT"] as const;

export const NOVEL_FORMAT_SUMMARY = "TXT / EPUB / MOBI / AZW3 / FB2 / PDF / DOCX / MD / HTML / ZIP";
export const DOC_FORMAT_SUMMARY = "PDF / PPTX / DOCX / MD / TXT";

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot).toLowerCase();
}

export function isSupportedNovelFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (NOVEL_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedDocFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (DOC_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedForMode(filename: string, mode: AppMode): boolean {
  return mode === "novel" ? isSupportedNovelFile(filename) : isSupportedDocFile(filename);
}

export function hasDraggedFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes("Files");
}
