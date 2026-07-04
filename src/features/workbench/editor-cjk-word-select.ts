import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// CJK 汉字 / 假名 / 谚文范围。命中才接管双击,其余(ASCII、代码标识符)交回
// CodeMirror 默认选词逻辑,保住 foo_bar、a.b 这类程序员习惯的整词选中。
const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

// tsconfig 的 lib 停在 ES2021,尚无 Intl.Segmenter 类型;这里按需最小声明。
// 运行时它在 Tauri webview(WKWebView / WebView2)原生可用。
type SegmenterCtor = new (
  locales?: string,
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => { segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> };

// 覆盖 col(UTF-16 code unit)的分词 segment;落在行尾则回看前一格。无 Segmenter 返回 null。
const segmentAt = (text: string, col: number): { from: number; to: number; isWordLike: boolean } | null => {
  const Segmenter = (Intl as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter !== "function") return null;

  const target = col >= text.length && col > 0 ? col - 1 : col;
  for (const { segment, index, isWordLike } of new Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (index <= target && target < index + segment.length) {
      return { from: index, to: index + segment.length, isWordLike: Boolean(isWordLike) };
    }
  }
  return null;
};

/**
 * 双击点在 text 的 col 处时,按词典分出的「词」边界,返回相对该行的 [from, to)。
 * 只在点到 CJK 且该段是「词」时接管;否则返回 null(交回 CodeMirror 默认)。纯函数,便于测试。
 */
export const cjkWordRangeAt = (text: string, col: number): [number, number] | null => {
  // posAtCoords 落在字符边界:被点的字符优先取后一个,否则取前一个。
  let target = col;
  if (!CJK.test(text[target] ?? "")) {
    if (target > 0 && CJK.test(text[target - 1] ?? "")) target -= 1;
    else return null;
  }

  const seg = segmentAt(text, target);
  return seg && seg.isWordLike ? [seg.from, seg.to] : null;
};

// 拖动时:光标所在位置的分词边界(任意类型:词/标点/空白),返回文档绝对坐标。
const wordRangeAtPos = (view: EditorView, pos: number): { from: number; to: number } => {
  const line = view.state.doc.lineAt(pos);
  const seg = segmentAt(line.text, pos - line.from);
  return seg ? { from: line.from + seg.from, to: line.from + seg.to } : { from: pos, to: pos };
};

// 双击选词 + 按词拖选:CJK 内容用 Intl.Segmenter(与浏览器同款 ICU 词典)以「词」为单位,
// 而非 CodeMirror 默认把一整串连续汉字当一个词。
// 必须接管 mousedown(detail===2):CodeMirror 就在这一步用 charCategorizer 选词并启动拖动,
// return true 抢先后由我们自己驱动这次拖动的按词扩选。
export const cjkWordSelect: Extension = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.detail !== 2 || event.shiftKey || event.altKey || event.metaKey) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const line = view.state.doc.lineAt(pos);
    const rel = cjkWordRangeAt(line.text, pos - line.from);
    if (!rel) return false;

    event.preventDefault();
    const anchor = { from: line.from + rel[0], to: line.from + rel[1] };
    view.dispatch({ selection: EditorSelection.range(anchor.from, anchor.to) });

    // 按住拖动 → 以「词」为单位扩选:锚定首个词,head 端吸附到光标所在词的边界。
    // ponytail: 不做拖到视口外的自动滚动,需要时再加。
    const onMove = (moveEvent: MouseEvent) => {
      const head = view.posAtCoords({ x: moveEvent.clientX, y: moveEvent.clientY }, false);
      const word = wordRangeAtPos(view, head);
      const selection =
        head >= anchor.to
          ? EditorSelection.range(anchor.from, Math.max(word.to, anchor.to))
          : EditorSelection.range(anchor.to, Math.min(word.from, anchor.from));
      view.dispatch({ selection });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return true;
  },
});
