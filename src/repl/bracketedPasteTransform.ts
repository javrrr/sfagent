/**
 * Bracketed paste (DEC mode 2004) — same idea as Claude Code / Ink (see
 * claude-code/src/ink/termio/csi.ts, App.tsx, useTextInput paste handling).
 *
 * Terminals wrap pasted text in ESC [ 200 ~ ... ESC [ 201 ~. We strip those
 * markers and replace inner newlines with LINE SEPARATOR (U+2028) so Node
 * readline does not treat each line as a separate submit. The REPL maps
 * U+2028 back to \n when building the user message.
 */

import { Transform } from "node:stream";
import type { Readable, Writable } from "node:stream";

/** Placeholder for \n inside a bracketed paste (readline only ends on real \n / \r\n). */
export const PASTE_LINE_BREAK = "\u2028";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function enableBracketedPasteMode(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?2004h");
  }
}

export function disableBracketedPasteMode(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?2004l");
  }
}

function normalizePastedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, PASTE_LINE_BREAK);
}

/** If `s` ends with an incomplete prefix of `marker`, hold that suffix back. */
function splitIncompletePrefix(s: string, marker: string): [string, string] {
  if (!s || !marker) return [s, ""];
  const max = Math.min(s.length, marker.length - 1);
  for (let l = max; l >= 1; l--) {
    const tail = s.slice(-l);
    if (marker.startsWith(tail)) {
      return [s.slice(0, -l), tail];
    }
  }
  return [s, ""];
}

export type TtyReadable = Readable & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
};

/**
 * Returns a readable stream that unwraps bracketed paste; forwards plain typing
 * unchanged. Forwards `isTTY` / `setRawMode` so readline can drive the TTY.
 */
export function createBracketedPasteTransform(source: TtyReadable): TtyReadable {
  if (!source.isTTY) {
    return source;
  }

  let carry = "";
  let inPaste = false;
  let pasteAccum = "";

  const tr = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        carry += Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
        let out = "";

        for (;;) {
          if (!inPaste) {
            const start = carry.indexOf(PASTE_START);
            if (start === -1) {
              const [safe, pend] = splitIncompletePrefix(carry, PASTE_START);
              out += safe;
              carry = pend;
              break;
            }
            out += carry.slice(0, start);
            carry = carry.slice(start + PASTE_START.length);
            inPaste = true;
            pasteAccum = "";
            continue;
          }

          const end = carry.indexOf(PASTE_END);
          if (end === -1) {
            const [safe, pend] = splitIncompletePrefix(carry, PASTE_END);
            pasteAccum += safe;
            carry = pend;
            break;
          }
          pasteAccum += carry.slice(0, end);
          carry = carry.slice(end + PASTE_END.length);
          out += normalizePastedText(pasteAccum);
          inPaste = false;
          pasteAccum = "";
        }

        callback(null, out);
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      if (inPaste) {
        this.push(normalizePastedText(pasteAccum + carry));
      } else if (carry) {
        this.push(carry);
      }
      carry = "";
      inPaste = false;
      pasteAccum = "";
      callback();
    },
  });

  source.pipe(tr);

  const sm = source.setRawMode;
  const ttyStream = tr as TtyReadable;
  ttyStream.isTTY = source.isTTY === true;
  if (typeof sm === "function") {
    ttyStream.setRawMode = (mode: boolean) => sm.call(source, mode);
  }

  return ttyStream;
}

export function detachBracketedPasteTransform(
  source: TtyReadable,
  transform: TtyReadable
): void {
  if (transform === source) return;
  source.unpipe(transform as unknown as Writable);
  transform.destroy();
}
