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
      <div className="p-4 text-xs text-ink-muted">请先选择一份文档查看大纲与页码内容。</div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="grid grid-cols-2 border-b border-line text-xs">
        <button
          type="button"
          onClick={() => setTab("outline")}
          className={`py-2.5 font-medium border-b-2 transition ${
            tab === "outline"
              ? "border-accent text-accent"
              : "border-transparent text-ink-secondary hover:text-ink"
          }`}
        >
          页面目录 ({detail.total_pages})
        </button>
        <button
          type="button"
          onClick={() => setTab("page")}
          className={`py-2.5 font-medium border-b-2 transition ${
            tab === "page"
              ? "border-accent text-accent"
              : "border-transparent text-ink-secondary hover:text-ink"
          }`}
        >
          页面原文
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "outline" ? (
          <div className="space-y-1.5">
            {detail.pages_outline.map((p) => (
              <button
                key={p.page_num}
                type="button"
                onClick={() => void openDocPage(detail.id, p.page_num)}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-elevated/60 px-3 py-2 text-left text-xs hover:border-accent"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">
                    P{p.page_num} · {p.heading}
                  </div>
                  <div className="text-[11px] text-ink-secondary">{p.char_count} 字</div>
                </div>
                {p.is_scanned_suspect && (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                )}
              </button>
            ))}
          </div>
        ) : loading ? (
          <p className="py-8 text-center text-xs text-ink-muted">正在加载页面内容...</p>
        ) : !docPageData ? (
          <div className="py-8 text-center text-xs text-ink-muted">
            点击目录或对话中的 [p:N] 引用查看具体页码内容。
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-line pb-2">
              <FileText className="h-4 w-4 text-accent" />
              <div>
                <div className="text-sm font-semibold text-ink">
                  第 {docPageData.page_num} 页 · {docPageData.heading}
                </div>
                <div className="text-[11px] text-ink-secondary">
                  {docPageData.char_count} 字
                  {docPageData.is_scanned_suspect && " · 疑似扫描/纯图页"}
                </div>
              </div>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-ink">
              {docPageData.content || "（本页未提取到纯文字内容）"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
