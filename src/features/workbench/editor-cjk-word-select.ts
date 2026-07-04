import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// CJK 汉字 / 假名 / 谚文范围。命中才接管双击,其余(ASCII、代码标识符)交回
// CodeMirror 默认选词逻辑,保住 foo_bar、a.b 这类程序员习惯的整词选中。
const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

/**
 * 双击点在 text 的 col 处(UTF-16 code unit)时,用 Intl.Segmenter 按词典分出的「词」
 * 边界。返回相对该行的 [from, to);不该接管(非 CJK / 非词 / 无 Segmenter)时返回 null。
 * 纯函数,便于测试;DOM/选区那层在下面的扩展里。
 */
export const cjkWordRangeAt = (text: string, col: number): [number, number] | null => {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter !== "function") return null;

  // posAtCoords 落在字符边界:被点的字符优先取后一个,否则取前一个。
  let target = col;
  if (!CJK.test(text[target] ?? "")) {
    if (target > 0 && CJK.test(text[target - 1] ?? "")) target -= 1;
    else return null;
  }

  for (const { segment, index, isWordLike } of new Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (index <= target && target < index + segment.length) {
      return isWordLike ? [index, index + segment.length] : null;
    }
  }
  return null;
};

// 双击选词:CJK 内容用 Intl.Segmenter(与浏览器同款 ICU 词典)选中「词语」,
// 而非 CodeMirror 默认把一整串连续汉字当一个词。
export const cjkWordSelect: Extension = EditorView.domEventHandlers({
  dblclick(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const line = view.state.doc.lineAt(pos);
    const range = cjkWordRangeAt(line.text, pos - line.from);
    if (!range) return false;

    view.dispatch({ selection: EditorSelection.range(line.from + range[0], line.from + range[1]) });
    return true;
  },
});
