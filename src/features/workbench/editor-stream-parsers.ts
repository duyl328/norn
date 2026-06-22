import { StreamLanguage, type StreamParser } from "@codemirror/language";

type EmptyParserState = Record<string, never>;

const consumeQuotedString = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  const quote = stream.next();
  let escaped = false;

  while (!stream.eol()) {
    const character = stream.next();

    if (character === quote && !escaped) {
      break;
    }

    escaped = character === "\\" && !escaped;

    if (character !== "\\") {
      escaped = false;
    }
  }

  return "string";
};

const matchSeverity = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  const match = stream.match(/^(?:fatal|error|warn(?:ing)?|info|debug|trace)\b/i);

  if (!match || typeof match === "boolean") {
    return null;
  }

  const level = match[0].toLowerCase();

  if (level === "fatal" || level === "error") {
    return "invalid";
  }

  if (level.startsWith("warn")) {
    return "keyword";
  }

  return "atom";
};

const matchCommonCue = (stream: Parameters<StreamParser<EmptyParserState>["token"]>[0]) => {
  if (stream.match(/^(?:todo|fixme|hack|note|xxx)\b/i)) {
    return "keyword";
  }

  const severity = matchSeverity(stream);

  if (severity) {
    return severity;
  }

  if (stream.match(/^(?:https?|file):\/\/[^\s"'<>]+/i)) {
    return "url";
  }

  if (stream.match(/^[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i)) {
    return "url";
  }

  if (stream.match(/^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)?/i)) {
    return "number";
  }

  if (stream.match(/^(?:(?:\.{1,2}|~)[\\/]|[a-z]:[\\/]|\/|\\\\)[^\s"'<>]+/i)) {
    return "string.special";
  }

  return null;
};

const genericConfigParser: StreamParser<EmptyParserState> = {
  name: "generic-config",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match(/^(?:#|;|\/\/).*$/)) {
      return "comment";
    }

    if (stream.match(/^\[[^\]\r\n]+\]/)) {
      return "heading";
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^(?:true|false|null|yes|no|on|off|enabled|disabled)\b/i)) {
      return "atom";
    }

    if (stream.match(/^[+-]?(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/i)) {
      return "number";
    }

    if (stream.match(/^[a-z_][\w.-]*(?=\s*[:=])/i)) {
      return "propertyName";
    }

    if (stream.match(/^[:=]/)) {
      return "operator";
    }

    if (stream.match(/^[{}[\](),.]/)) {
      return "punctuation";
    }

    if (stream.match(/^[^\s#;:=[\]"']+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

const genericLogParser: StreamParser<EmptyParserState> = {
  name: "generic-log",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^\[[^\]\r\n]+\]/)) {
      return "labelName";
    }

    if (stream.match(/^\([^)]+\)/)) {
      return "labelName";
    }

    if (stream.match(/^[+-]?(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/i)) {
      return "number";
    }

    if (stream.match(/^[^\s"'()[\]]+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

const genericTextCueParser: StreamParser<EmptyParserState> = {
  name: "generic-text-cues",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    const cue = matchCommonCue(stream);

    if (cue) {
      return cue;
    }

    const next = stream.peek();

    if (next === '"' || next === "'") {
      return consumeQuotedString(stream);
    }

    if (stream.match(/^[a-z_][\w.-]*(?=\s*[:=])/i)) {
      return "propertyName";
    }

    if (stream.match(/^[:=]/)) {
      return "operator";
    }

    if (stream.match(/^[^\s"'=:]+/)) {
      return null;
    }

    stream.next();
    return null;
  },
};

export const genericConfigLanguage = StreamLanguage.define(genericConfigParser);
export const genericLogLanguage = StreamLanguage.define(genericLogParser);
export const genericTextCueLanguage = StreamLanguage.define(genericTextCueParser);
