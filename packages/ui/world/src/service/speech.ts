/** A line's pace as said, and who hears it — see `docs/speech.md` */
export const speechConfig = {
  /** Seconds each word takes to say */
  wordSecs: 0.4,
  /** Seconds a page stays once said, to be read */
  readSecs: 2,
  /** Words heard or missed together */
  chunkWords: 3,
  /** Within this, and through open doors, a line is heard */
  hearMetres: 8,
};

/** A line as said: its pages, each word's start, and its chunks' */
export function utteranceOf(text: string): Utterance {
  const { wordSecs, chunkWords } = speechConfig;
  const pages = pagesOf(text);
  const words: SaidWord[] = [];
  const chunks: SaidChunk[] = [];
  const pageAt: number[] = [];
  const pageChunks: number[][] = [];
  let at = 0;
  pages.forEach((page, p) => {
    pageAt.push(at);
    pageChunks.push([]);
    const pageWords = page.split(/\s+/);
    pageWords.forEach((word, i) => {
      if (i % chunkWords === 0) {
        pageChunks[p].push(chunks.length);
        chunks.push({ at: at + i * wordSecs, text: "", words: [] });
      }
      const chunk = chunks[chunks.length - 1];
      chunk.text += chunk.text === "" ? word : ` ${word}`;
      chunk.words.push(words.length);
      words.push({ text: word, at: at + i * wordSecs });
    });
    at += wordSecs * pageWords.length + speechConfig.readSecs;
  });
  const lastWord = words.at(-1);
  return { pages, pageAt, pageChunks, words, chunks, spokenSecs: (lastWord?.at ?? 0) + wordSecs };
}

/** Seconds a page is shown: its words said, then read */
export const pageSecs = (page: string) =>
  speechConfig.wordSecs * page.trim().split(/\s+/).length + speechConfig.readSecs;

/** A line as pages: whole sentences, each page at most `pageChars` unless one word is longer */
function pagesOf(words: string) {
  const sentences = words.trim().match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) ?? [words];
  const pages: string[] = [];
  for (const part of sentences.flatMap((sentence) =>
    sentence.length <= pageChars ? [sentence] : sentence.split(/(?<=\s)/),
  )) {
    const last = pages.at(-1);
    if (last !== undefined && last.length + part.length <= pageChars) pages[pages.length - 1] = last + part;
    else pages.push(part);
  }
  const trimmed = pages.map((page) => page.trim()).filter((page) => page !== "");
  return trimmed.length > 0 ? trimmed : [words];
}

/** Characters a bubble's page holds, at most */
const pageChars = 120;

export type Utterance = {
  pages: string[];
  /** Seconds into the line each page starts */
  pageAt: number[];
  /** Each page's chunks, by index */
  pageChunks: number[][];
  words: SaidWord[];
  chunks: SaidChunk[];
  /** Seconds until its last word is said */
  spokenSecs: number;
};

export type SaidWord = { text: string; at: number };

/** Words heard or missed together: their text, and their indices in `words` */
export type SaidChunk = { at: number; text: string; words: number[] };
