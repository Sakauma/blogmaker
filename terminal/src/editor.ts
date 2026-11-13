/** Readline-style edits, scoped by the caller to the command textarea. */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function editCommandInput(input: HTMLTextAreaElement, key: string): boolean {
  const value = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const boundaries = [...graphemes.segment(value)].map(segment => segment.index);
  boundaries.push(value.length);
  const reversed = [...boundaries].reverse();
  const before = (position: number): number => reversed.find(boundary => boundary < position) ?? 0;
  const after = (position: number): number => boundaries.find(boundary => boundary > position) ?? value.length;
  const floor = (position: number): number => reversed.find(boundary => boundary <= position) ?? 0;
  const ceil = (position: number): number => boundaries.find(boundary => boundary >= position) ?? value.length;
  const lineStart = (position: number): number => value.slice(0, position).lastIndexOf('\n') + 1;
  const lineEnd = (position: number): number => { const newline = value.indexOf('\n', position); return newline < 0 ? value.length : newline; };
  const move = (position: number): void => { input.setSelectionRange(position, position); };
  const remove = (from: number, to: number): void => {
    from = floor(from);
    to = ceil(to);
    input.setRangeText('', from, to, 'start');
  };
  switch (key) {
    case 'a': move(lineStart(start)); break;
    case 'e': move(lineEnd(end)); break;
    case 'b': move(start !== end ? floor(start) : before(start)); break;
    case 'f': move(start !== end ? ceil(end) : after(end)); break;
    case 'd': remove(start, start === end ? after(end) : end); break;
    case 'k': {
      const edge = lineEnd(end);
      remove(start, start === end && edge === end && end < value.length ? end + 1 : edge);
      break;
    }
    case 'u': remove(lineStart(start), end); break;
    case 'w': {
      if (start !== end) { remove(start, end); break; }
      let from = start;
      while (from > 0 && /\s/u.test(value[from - 1])) from--;
      while (from > 0 && !/\s/u.test(value[from - 1])) from--;
      remove(from, end);
      break;
    }
    default: return false;
  }
  return true;
}
