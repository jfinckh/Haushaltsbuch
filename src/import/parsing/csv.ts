// A small CSV reader for bank exports: one delimiter, fields optionally in double quotes, a quote
// inside quotes written as two.

/** Splits text into records at CR/LF or LF; a line break inside quotes stays in its record. */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "\n" || (char === "\r" && text[i + 1] === "\n"))) {
      lines.push(current);
      current = "";
      if (char === "\r") i++;
      continue;
    }
    current += char;
  }
  lines.push(current);
  return lines;
}

/** Splits one record into its fields. */
export function splitFields(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}
