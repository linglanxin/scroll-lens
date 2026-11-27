import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, ScanEye, Square } from "lucide-react";
import { documentsApi } from "../../api/documents";
import { useAppStore } from "../../stores/appStore";
import { useReaderStore } from "../../stores/readerStore";
import type { DocOcrStatus, DocumentDetail } from "../../types/api";

export function DocumentRightPanel() {
  const { selectedDocId, selectedProviderId, refreshDocs } = useAppStore();
  const { docPageData, loading, openDocPage } = useReaderStore();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [ocrStatus, setOcrStatus] = useState<DocOcrStatus | null>(null);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"outline" | "page">("outline");

  const loadDetailAndStatus = useCallback(async (docId: number) => {
    try {
      const [d, st] = await Promise.all([
        documentsApi.get(docId),
        documentsApi.ocrStatus(docId),
      ]);
      setDetail(d);
      setOcrStatus(st);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    setOcrNotice(null);
    if (!selectedDocId) {
      setDetail(null);
      setOcrStatus(null);
      return;
    }
    void loadDetailAndStatus(selectedDocId);
  }, [selectedDocId, loadDetailAndStatus]);

  useEffect(() => {
    if (!selectedDocId || !ocrStatus?.running) return;
    const timer = window.setInterval(async () => {
      try {
        const st = await documentsApi.ocrStatus(selectedDocId);
        setOcrStatus(st);
        if (!st.running) {
          await Promise.all([loadDetailAndStatus(selectedDocId), refreshDocs()]);
          if (docPageData && docPageData.doc_id === selectedDocId) {
            void openDocPage(selectedDocId, docPageData.page_num);
          }
          setOcrNotice(
            st.last_error
              ? `识图结束（完成 ${st.completed_pages}/${st.total_pages} 页）：${st.last_error}`
              : `视觉 OCR 已完成（共识别 ${st.completed_pages} 页）`
          );
        }
      } catch {
        // ignore transient polling error
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedDocId, ocrStatus?.running, loadDetailAndStatus, refreshDocs, docPageData, openDocPage]);

  useEffect(() => {
    if (docPageData) {
      setTab("page");
    }
  }, [docPageData?.page_num, docPageData?.doc_id]);

  async function triggerOcr(pageNums?: number[]) {
    if (!detail) return;
    setOcrNotice(null);
    try {
      const res = await documentsApi.startOcr(detail.id, selectedProviderId, pageNums);
      setOcrStatus({
        running: true,
        total_pages: res.total_pages,
        completed_pages: 0,
        failed_pages: 0,
        current_page: res.queued_pages[0] ?? null,
        last_error: "",
        has_ocr_assets: true,
      });
    } catch (err) {
      setOcrNotice(err instanceof Error ? err.message : "启动视觉 OCR 失败");
    }
  }

  if (!selectedDocId || !detail) {
    return (
      <div className="p-6 text-center text-xs text-ink-muted">
        请先上传或选择一份文档查看页面目录与正文。
      </div>
    );
  }

  const ocrRunning = Boolean(ocrStatus?.running);

  return (
    <div className="flex h-full flex-col bg-surface min-h-0">
      <div className="grid grid-cols-2 border-b border-line text-xs shrink-0">
        <button
          type="button"
          onClick={() => setTab("outline")}
          className={`sl-num h-10 font-medium border-b-2 transition ${
            tab === "outline"
              ? "border-accent text-ink"
              : "border-transparent text-ink-secondary hover:text-ink"
          }`}
        >
          页面目录 ({detail.total_pages})
        </button>
        <button
          type="button"
          onClick={() => setTab("page")}
          className={`h-10 font-medium border-b-2 transition ${
            tab === "page"
              ? "border-accent text-ink"
              : "border-transparent text-ink-secondary hover:text-ink"
          }`}
        >
          页面原文
        </button>
      </div>

      {ocrNotice && (
        <div className="flex items-center justify-between gap-2 border-b border-line bg-accent-soft/60 px-3.5 py-2 text-[11px] text-ink shrink-0">
          <span className="truncate">{ocrNotice}</span>
          <button type="button" onClick={() => setOcrNotice(null)} className="shrink-0 underline">
            关闭
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-[max(2.25rem,calc(1.25rem+env(safe-area-inset-bottom)))]">
        {tab === "outline" ? (
          <div className="space-y-2">
            {(detail.has_scanned_pages || ocrRunning) && (
              <div className="rounded-xl border border-line bg-elevated/70 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                    <ScanEye className="h-3.5 w-3.5 text-accent" />
                    <span>
                      {ocrRunning
                        ? `视觉 OCR 识图中（${ocrStatus?.completed_pages ?? 0}/${ocrStatus?.total_pages ?? 0} 页）`
                        : `检测到 ${detail.scanned_page_count} 页扫描/纯图页`}
                    </span>
                  </div>
                  {ocrRunning ? (
                    <button
                      type="button"
                      onClick={() => void documentsApi.cancelOcr(detail.id)}
                      className="sl-btn inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink-secondary hover:text-ink"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      <span>停止</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={detail.has_ocr_assets === false}
                      onClick={() => void triggerOcr()}
                      className="sl-btn inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-accent-fg disabled:opacity-45"
                      title={
                        detail.has_ocr_assets === false
                          ? "旧版上传的文档不含图片缓存，请重新上传后使用视觉 OCR"
                          : "调用当前所选多模态视觉模型识别所有扫描页"
                      }
                    >
                      <ScanEye className="h-3 w-3" />
                      <span>一键识别全部</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  {ocrRunning
                    ? `正在识别第 ${ocrStatus?.current_page ?? "-"} 页，完成后将自动更新正文与检索索引。`
                    : "需选用支持视觉输入的模型（如 GPT-4o / Gemini / Claude / Qwen-VL）。"}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              {detail.pages_outline.map((p) => {
                const isCurrent =
                  docPageData?.doc_id === detail.id && docPageData?.page_num === p.page_num;
                return (
                  <button
                    key={p.page_num}
                    type="button"
                    onClick={() => void openDocPage(detail.id, p.page_num)}
                    className={`sl-btn flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs ${
                      isCurrent
                        ? "border-accent bg-accent-soft/50"
                        : "border-line bg-elevated/40 hover:border-line-strong"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-medium text-ink">
                        <span className="sl-num text-accent mr-1.5">P{p.page_num}</span>
                        {p.heading}
                      </div>
                      <div className="sl-num mt-0.5 text-[11px] text-ink-muted">
                        {p.char_count} 字
                      </div>
                    </div>
                    {p.is_scanned_suspect && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : loading ? (
          <p className="py-10 text-center text-xs text-ink-muted">正在加载页面内容...</p>
        ) : !docPageData ? (
          <div className="py-10 text-center text-xs text-ink-muted">
            点击目录或对话中的 <code className="rounded bg-elevated px-1">[p:N]</code> 引用即可查看对应页正文。
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="flex items-start justify-between gap-2.5 border-b border-line pb-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    <span className="sl-num">第 {docPageData.page_num} 页</span> ·{" "}
                    {docPageData.heading}
                  </div>
                  <div className="sl-num text-[11px] text-ink-muted mt-0.5">
                    {docPageData.char_count} 字
                    {docPageData.is_scanned_suspect && " · 疑似扫描/纯图页"}
                  </div>
                </div>
              </div>
              {docPageData.is_scanned_suspect && detail.has_ocr_assets !== false && (
                <button
                  type="button"
                  disabled={ocrRunning}
                  onClick={() => void triggerOcr([docPageData.page_num])}
                  className="sl-btn inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent-soft/60 px-2.5 text-[11px] font-medium text-accent disabled:opacity-50"
                >
                  {ocrRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ScanEye className="h-3 w-3" />
                  )}
                  <span>识别本页</span>
                </button>
              )}
            </div>
            <div className="whitespace-pre-wrap text-[14px] leading-7 text-ink">
              {docPageData.content || "（本页未提取到纯文字内容，可点击上方「识别本页」执行多模态视觉 OCR）"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
