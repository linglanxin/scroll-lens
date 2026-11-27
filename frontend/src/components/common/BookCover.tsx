import { useState } from "react";
import { getStoredToken } from "../../api/client";
import type { Book } from "../../types/api";

interface BookCoverProps {
  book: Book;
  className?: string;
}

const COVER_PALETTES = [
  { bg: "bg-[#1E3A5F]", border: "border-[#3B6294]/50", accent: "text-[#BFDBFE]" },
  { bg: "bg-[#2C4A3E]", border: "border-[#548370]/50", accent: "text-[#BBF7D0]" },
  { bg: "bg-[#4A2B36]", border: "border-[#844F62]/50", accent: "text-[#FBCFE8]" },
  { bg: "bg-[#3D3456]", border: "border-[#6F6096]/50", accent: "text-[#DDD6FE]" },
  { bg: "bg-[#4C3B28]", border: "border-[#8A6D4D]/50", accent: "text-[#FDE68A]" },
  { bg: "bg-[#273B47]", border: "border-[#4E7287]/50", accent: "text-[#BAE6FD]" },
];

function hashTitle(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function BookCover({ book, className = "" }: BookCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const token = getStoredToken();
  const coverSrc =
    book.has_cover && book.cover_url && !imgFailed
      ? `${book.cover_url}${token ? `?token=${encodeURIComponent(token)}` : ""}`
      : null;

  const palette = COVER_PALETTES[hashTitle(book.title) % COVER_PALETTES.length];
  const pct =
    book.total_chapters > 0
      ? Math.min(100, Math.round((book.read_progress_ch / book.total_chapters) * 100))
      : 0;

  return (
    <div
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-line bg-elevated shadow-sm select-none ${className}`}
    >
      {coverSrc ? (
        <img
          src={coverSrc}
          alt={book.title}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className={`relative flex h-full w-full flex-col justify-between p-2.5 pl-3.5 ${palette.bg} text-white`}>
          {/* Classic subtle book spine crease */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-black/20" />
          <div className="pointer-events-none absolute inset-y-0 left-2 w-px bg-white/15" />

          <div className={`mt-4 rounded-md border ${palette.border} px-1.5 py-2 flex-1 flex flex-col justify-between`}>
            <div className="font-serif text-[13px] font-semibold leading-snug tracking-wide text-white line-clamp-4 break-words">
              {book.title}
            </div>
            <div className={`mt-1 truncate text-[10px] ${palette.accent}`}>
              {book.author?.trim() || `${book.total_volumes} 卷`}
            </div>
          </div>
        </div>
      )}

      {/* Corner reading progress badge (Legado / Anx Reader / Readest pattern) */}
      <span className="sl-num absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {pct}%
      </span>

      {/* Thin bottom progress indicator */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
        <div
          className="h-full bg-accent-lens"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
