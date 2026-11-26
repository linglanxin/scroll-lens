import { useEffect, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { documentsApi } from "../../api/documents";
import { useAppStore } from "../../stores/appStore";
import { useReaderStore } from "../../stores/readerStore";
import type { DocumentDetail } from "../../types/api";

export function DocumentRightPanel() {
  const { selectedDocId } = useAppStore();
  const { docPageData, loading, openDocPage } = useReaderStore();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [tab, setTab] = useState<"outline" | "page">("outline");

  useEffect(() => {
    if (!selectedDocId) {
      setDetail(null);
      return;
    }
    void documentsApi
      .get(selectedDocId)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null));
  }, [selectedDocId]);

  useEffect(() => {
    if (docPageData) {
      setTab("page");
    }
  }, [docPageData?.page_num, docPageData?.doc_id]);

  if (!selectedDocId || !detail) {
    return (
      <div className="p-6 text-center text-xs text-ink-muted">
        请先上传或选择一份文档查看页面目录与正文。
      </div>
    );
  }

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

      <div className="flex-1 overflow-y-auto p-3.5">
        {tab === "outline" ? (
          <div className="space-y-1.5">
            {detail.pages_outline.map((p) => {
              const isCurrent = docPageData?.doc_id === detail.id && docPageData?.page_num === p.page_num;
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
                    <AlertTriangle
                      className="h-3.5 w-3.5 shrink-0 text-warning"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : loading ? (
          <p className="py-10 text-center text-xs text-ink-muted">正在加载页面内容...</p>
        ) : !docPageData ? (
          <div className="py-10 text-center text-xs text-ink-muted">
            点击目录或对话中的 <code className="rounded bg-elevated px-1">[p:N]</code> 引用即可查看对应页正文。
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="flex items-start gap-2.5 border-b border-line pb-3">
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
            <div className="whitespace-pre-wrap text-[14px] leading-7 text-ink">
              {docPageData.content || "（本页未提取到纯文字内容）"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
