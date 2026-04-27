export function markdownToHtml(markdown: string): string {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const language = fence[1] ?? "text";
      const code: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      html.push(`<pre><code class="language-${escapeAttribute(language)}">${escapeHtml(code.join("\n"))}\n</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      html.push(`<h${level} id="${slugify(text)}">${renderInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    const unordered = line.match(/^\s*-\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*-\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1].trim())}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+\.\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1].trim())}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;

    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }

  const end = markdown.indexOf("\n---\n", 4);
  return end === -1 ? markdown : markdown.slice(end + 5);
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim();
  const separator = lines[index + 1]?.trim();
  return Boolean(header?.includes("|") && separator && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator));
}

function renderTable(lines: string[]): string {
  const [headerLine, , ...bodyLines] = lines;
  const headers = splitTableRow(headerLine);
  const rows = bodyLines.map(splitTableRow);

  const thead = `<thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;

  return `<table>${thead}${tbody}</table>`;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(input: string): string {
  let html = escapeHtml(input);
  const codeSpans: string[] = [];

  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `@@CODE_${codeSpans.length}@@`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    return `<a href="${escapeAttribute(normalizeHref(href))}">${label}</a>`;
  });

  for (const [i, code] of codeSpans.entries()) {
    html = html.replace(`@@CODE_${i}@@`, code);
  }

  return html;
}

function normalizeHref(href: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) {
    return href;
  }

  const [path] = href.split("#");
  if (path.endsWith(".md")) {
    return `#${path.replace(/\.md$/, "").replace(/\//g, "-")}`;
  }

  return href;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(input: string): string {
  return escapeHtml(input).replace(/'/g, "&#39;");
}
