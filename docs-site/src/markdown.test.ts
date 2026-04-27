import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown.js";

describe("markdownToHtml", () => {
  it("renders headings, links, lists, tables, and fenced code for the docs site", () => {
    const html = markdownToHtml(`# Title

See [CLI](cli.md) and [remote](remote/macos-offload.md).

- One
- Two

| Name | Purpose |
| --- | --- |
| Steward | Decides |

\`\`\`sh
npm run docs:build
\`\`\`
`);

    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<a href="#cli">CLI</a>');
    expect(html).toContain('<a href="#remote-macos-offload">remote</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain('<pre><code class="language-sh">npm run docs:build');
  });

  it("escapes raw HTML before applying inline formatting", () => {
    const html = markdownToHtml("Use `<script>` and **bold** text.");

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script>");
  });
});
