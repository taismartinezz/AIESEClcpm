"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, ZoomIn, ZoomOut, MessageSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { LitAnnotation, AnnotationBbox } from "@/types";
import PDFAnnotationLayer from "./PDFAnnotationLayer";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

const ANNOT_COLORS_LABEL: Record<string, string> = {
  "#FBBF24": "Yellow",
  "#34D399": "Green",
  "#60A5FA": "Blue",
  "#F87171": "Red",
  "#A78BFA": "Purple",
};

export default function PDFViewer({
  url,
  itemId,
  currentUserId,
  annotations,
  onAnnotationAdded,
  onClose,
  initialPage = 1,
  openTabUrl,
}: {
  url: string;
  itemId: string;
  currentUserId: string;
  annotations: LitAnnotation[];
  onAnnotationAdded: (a: LitAnnotation) => void;
  onClose: () => void;
  initialPage?: number;
  openTabUrl?: string;
}) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [pageWidth, setPageWidth] = useState(700);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    function measure() {
      // Use the scroll pane's own width (excludes the 280px annotation sidebar)
      // so the page is sized and centered within its actual container, not the outer div.
      if (scrollRef.current) {
        const available = Math.floor(scrollRef.current.offsetWidth - 32);
        setPageWidth(Math.max(400, Math.min(available, 820)));
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Scroll to initialPage after document loads
  useEffect(() => {
    if (numPages > 0 && initialPage > 1) {
      setTimeout(() => {
        pageRefs.current[initialPage - 1]?.scrollIntoView({ behavior: "auto", block: "start" });
      }, 100);
    }
  }, [numPages, initialPage]);

  // IntersectionObserver - track which page is currently most visible
  useEffect(() => {
    if (!numPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) {
            best = entry;
          }
        }
        if (best) {
          const n = parseInt((best.target as HTMLElement).dataset.page ?? "1");
          if (n >= 1) setCurrentPage(n);
        }
      },
      { root: scrollRef.current, threshold: [0, 0.25, 0.5, 0.75, 1.0] }
    );
    pageRefs.current.slice(0, numPages).forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [numPages]);

  function scrollToPage(n: number) {
    const target = Math.max(1, Math.min(n, numPages));
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") scrollToPage(currentPage + 1);
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   scrollToPage(currentPage - 1);
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, numPages, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAnnotation = useCallback(async ({
    bbox, comment, text, color, pageNum,
  }: {
    bbox: AnnotationBbox; comment: string; text: string; color?: string; pageNum: number;
  }) => {
    setSaving(true);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error } = await supabase.from("lit_annotations").insert({
      id,
      item_id: itemId,
      author_id: currentUserId,
      text: text ?? "",
      comment,
      page_number: pageNum,
      bbox,
      ...(color ? { color } : {}),
    });
    if (error) {
      console.error("[PDFViewer] annotation insert error:", error.message);
    } else {
      onAnnotationAdded({
        id, itemId, authorId: currentUserId,
        text: text ?? "", comment, createdAt: now, color,
        pageNumber: pageNum, bbox,
      });
    }
    setSaving(false);
  }, [itemId, currentUserId, onAnnotationAdded]);

  const renderedWidth = Math.round(pageWidth * scale);

  // Sidebar: all annotations, grouped by page
  const annotsByPage = annotations.reduce<Record<number, LitAnnotation[]>>((acc, a) => {
    const p = a.pageNumber ?? 0;
    if (!acc[p]) acc[p] = [];
    acc[p].push(a);
    return acc;
  }, {});
  const sortedPages = Object.keys(annotsByPage).map(Number).sort((a, b) => a - b);
  const threadAnnots = annotations.filter((a) => !a.bbox && !a.parentId);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.88)", display: "flex", flexDirection: "column" }}
      role="dialog"
      aria-modal="true"
      aria-label="PDF Viewer"
    >
      {/* Top bar */}
      <div style={{ height: 52, flexShrink: 0, backgroundColor: "#1b2e4b", display: "flex", alignItems: "center", paddingInline: 16, gap: 12 }}>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#fff", fontSize: 13, fontWeight: 600 }}
        >
          <X size={16} /> Close
        </button>

        {openTabUrl && (
          <a href={openTabUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#ffffff99", textDecoration: "none", border: "1px solid #ffffff33", borderRadius: 6, padding: "4px 10px", whiteSpace: "nowrap" }}>
            Open in new tab
          </a>
        )}

        <div style={{ flex: 1 }} />

        {/* Page indicator */}
        <span style={{ color: "#fff", fontSize: 13, whiteSpace: "nowrap" }}>
          {numPages > 0 ? `p. ${currentPage} / ${numPages}` : "Loading…"}
        </span>

        <div style={{ width: 1, height: 24, backgroundColor: "#ffffff33", marginInline: 4 }} />

        {/* Zoom */}
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))} disabled={scale <= 0.5}
          style={{ background: "none", border: "none", cursor: "pointer", color: scale > 0.5 ? "#fff" : "#ffffff55", display: "flex" }} aria-label="Zoom out">
          <ZoomOut size={18} />
        </button>
        <span style={{ color: "#fff", fontSize: 12, minWidth: 44, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(2.0, +(s + 0.25).toFixed(2)))} disabled={scale >= 2.0}
          style={{ background: "none", border: "none", cursor: "pointer", color: scale < 2.0 ? "#fff" : "#ffffff55", display: "flex" }} aria-label="Zoom in">
          <ZoomIn size={18} />
        </button>
      </div>

      {/* Body */}
      <div ref={containerRef} style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* PDF scroll pane */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", gap: 16 }}
        >
          {loadError && (
            <div style={{ marginTop: 40, maxWidth: 420, textAlign: "center" }}>
              <p style={{ color: "#F87171", fontSize: 13, marginBottom: 8 }}>{loadError}</p>
              {openTabUrl && (
                <p style={{ color: "#ffffff99", fontSize: 12, lineHeight: 1.6 }}>
                  This PDF is hosted on an external domain that may block cross-origin requests.{" "}
                  Use the <strong style={{ color: "#fff" }}>Open in new tab</strong> button above.
                </p>
              )}
            </div>
          )}

          <Document
            file={url}
            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setLoadError(""); pageRefs.current = Array(n).fill(null); }}
            onLoadError={(err) => setLoadError(`Could not load PDF: ${err.message}`)}
            loading={<span style={{ color: "#ffffff99", fontSize: 13 }}>Loading PDF…</span>}
          >
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1;
              return (
                <div
                  key={n}
                  ref={(el) => { pageRefs.current[i] = el; }}
                  data-page={n}
                  style={{ position: "relative", display: "inline-block", flexShrink: 0 }}
                >
                  <Page
                    pageNumber={n}
                    width={renderedWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  <PDFAnnotationLayer
                    pageNumber={n}
                    annotations={annotations}
                    onSave={(params) => handleSaveAnnotation({ ...params, pageNum: n })}
                    saving={saving}
                  />
                </div>
              );
            })}
          </Document>
        </div>

        {/* Annotation sidebar */}
        <div style={{ width: 280, flexShrink: 0, backgroundColor: "#f8fafc", borderLeft: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", margin: 0 }}>
              Highlights
            </p>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, marginBottom: 0 }}>
              Drag to mark a region. Type the quoted words separately in the popover - the box and the quote are independent.
            </p>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px" }}>
            {sortedPages.filter(p => p > 0).map((p) => {
              const bboxAnnots = (annotsByPage[p] ?? []).filter((a) => a.bbox);
              if (!bboxAnnots.length) return null;
              return (
                <div key={p} style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => scrollToPage(p)}
                    style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "0 0 6px 0", display: "block", width: "100%", textAlign: "left" }}
                  >
                    Page {p}
                  </button>
                  {bboxAnnots.map((a) => (
                    <div key={a.id} style={{ marginBottom: 8, borderRadius: 8, border: `1px solid ${a.color ?? "#e2e8f0"}`, borderLeft: `3px solid ${a.color ?? "#FBBF24"}`, backgroundColor: "#fff", padding: "8px 10px", fontSize: 12 }}>
                      {a.text && <p style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginBottom: 4, marginTop: 0, lineHeight: 1.5 }}>"{a.text}"</p>}
                      <p style={{ color: "#1e293b", lineHeight: 1.5, margin: 0 }}>{a.comment}</p>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                        {a.color && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: a.color, flexShrink: 0 }} />}
                        {a.color && <span style={{ fontSize: 10, color: "#94a3b8" }}>{ANNOT_COLORS_LABEL[a.color] ?? ""}</span>}
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {sortedPages.filter(p => p > 0).every(p => !(annotsByPage[p] ?? []).filter(a => a.bbox).length) && annotations.filter(a => a.bbox).length === 0 && (
              <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginTop: 20 }}>No highlights yet.</p>
            )}

            {threadAnnots.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", margin: "0 0 8px" }}>
                  <MessageSquare size={10} style={{ display: "inline", marginRight: 4 }} />
                  Comments ({threadAnnots.length})
                </p>
                {threadAnnots.map((a) => (
                  <div key={a.id} style={{ marginBottom: 8, fontSize: 11, color: "#64748b", borderLeft: "2px solid #e2e8f0", paddingLeft: 8, lineHeight: 1.5 }}>
                    {a.text && <span style={{ fontStyle: "italic", display: "block" }}>"{a.text}"</span>}
                    <span>{a.comment}</span>
                    {a.pageRef && <span style={{ display: "block", fontSize: 10, color: "#94a3b8" }}>ref: {a.pageRef}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
