import { Fragment, type ReactNode } from "react";

/**
 * Just enough Markdown for notes people write in a textarea: "#"–"###" headings,
 * "-"/"*" and "1." lists, **bold**, and paragraphs. Builds React elements (never
 * HTML strings), so whatever someone types can't inject markup.
 */
export default function SimpleMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} style={{ margin: "0 0 10px" }}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{inline(it)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} style={{ margin: "0 0 10px", paddingLeft: 20 }}>{items}</ol>
      : <ul key={blocks.length} style={{ margin: "0 0 10px", paddingLeft: 20 }}>{items}</ul>);
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const size = [17, 15, 14][heading[1].length - 1];
      blocks.push(<p key={blocks.length} role="heading" aria-level={heading[1].length + 1} style={{ fontSize: size, fontWeight: 700, color: "var(--color-navy)", margin: blocks.length ? "14px 0 6px" : "0 0 6px" }}>{inline(heading[2])}</p>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return <>{blocks}</>;
}

/** **bold** inside a line. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}
