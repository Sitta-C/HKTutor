export interface MessageTextPart {
  text: string;
  start: number;
  href: string | null;
}

function trimLinkEnd(candidate: string): string {
  let link = candidate;
  let previous: string;
  do {
    previous = link;
    link = link.replace(/[.,!?;:…。，！？、]+$/u, '');
    // Keep parentheses in paths, but leave surrounding sentence brackets outside the link.
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ] as const) {
      if (link.endsWith(close) && link.split(close).length > link.split(open).length) {
        link = link.slice(0, -1);
      }
    }
  } while (link !== previous);
  return link;
}

export function splitMessageLinks(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let offset = 0;
  const candidates = /(?:https?:\/\/|www\.)[^\s<>"'`‘’“”]+/giu;
  for (const match of text.matchAll(candidates)) {
    const start = match.index;
    // Do not link fragments of an email, another scheme or a larger word.
    if (start > 0 && /[\p{L}\p{N}_@:/\\.-]/u.test(text[start - 1] ?? '')) {
      continue;
    }
    const link = trimLinkEnd(match[0]);
    const href = /^www\./iu.test(link) ? `https://${link}` : link;
    try {
      const url = new URL(href);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname ||
        url.hostname === 'www' ||
        url.username ||
        url.password ||
        link.includes('\\')
      ) {
        continue;
      }
    } catch {
      continue;
    }
    if (start > offset) {
      parts.push({ text: text.slice(offset, start), start: offset, href: null });
    }
    parts.push({ text: link, start, href });
    offset = start + link.length;
  }
  if (offset < text.length) {
    parts.push({ text: text.slice(offset), start: offset, href: null });
  }
  return parts;
}
