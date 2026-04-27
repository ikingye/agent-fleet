import { useEffect, useMemo, useState } from "react";
import { docsGroups, docsPages, type DocsPage } from "./content.js";
import { markdownToHtml } from "./markdown.js";

function currentSlug(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "home";
}

export function App() {
  const [activeSlug, setActiveSlug] = useState(currentSlug);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onHashChange = () => setActiveSlug(currentSlug());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const activePage = docsPages.find((page) => page.slug === activeSlug) ?? docsPages[0];
  const html = useMemo(() => markdownToHtml(activePage.body), [activePage.body]);
  const visiblePages = useMemo(() => filterPages(query), [query]);

  useEffect(() => {
    document.title = `${activePage.title} | agent-fleet docs`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activePage]);

  return (
    <div className="docs-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="agent-fleet docs home">
          <img src="logo.svg" alt="" />
          <span>
            <strong>agent-fleet</strong>
            <small>v0.1.0 docs</small>
          </span>
        </a>
        <nav className="topnav" aria-label="Primary documentation sections">
          <a href="#getting-started">Start</a>
          <a href="#steward-worker-model">Model</a>
          <a href="#remote-workers">Remote</a>
          <a href="#publishing">Pages</a>
        </nav>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Documentation navigation">
          <label className="search">
            <span>Search docs</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="decision, webhook, recovery"
            />
          </label>

          <div className="navgroups">
            {docsGroups.map((group) => {
              const pages = visiblePages.filter((page) => page.group === group);
              if (pages.length === 0) return null;

              return (
                <section key={group}>
                  <h2>{group}</h2>
                  {pages.map((page) => (
                    <a
                      key={page.slug}
                      className={page.slug === activePage.slug ? "active" : ""}
                      href={`#${page.slug}`}
                    >
                      <span>{page.title}</span>
                      <small>{page.description}</small>
                    </a>
                  ))}
                </section>
              );
            })}
          </div>
        </aside>

        <main className="content-panel">
          <section className="doc-hero" aria-labelledby="page-title">
            <p className="eyebrow">{activePage.group}</p>
            <h1 id="page-title">{activePage.title}</h1>
            <p>{activePage.description}</p>
          </section>

          <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </main>

        <aside className="release-rail" aria-label="Release essentials">
          <section>
            <h2>Release Essentials</h2>
            <a href="#getting-started">Install and verify</a>
            <a href="#steward-worker-model">Keep Steward/Worker boundary</a>
            <a href="#connectors-security">Check connector security</a>
            <a href="#remote-workers">Prepare remote prerequisites</a>
            <a href="#publishing">Build and publish Pages</a>
          </section>
          <section>
            <h2>Build</h2>
            <code>npm run docs:build</code>
            <code>npm run check</code>
            <code>npm run build</code>
          </section>
        </aside>
      </div>
    </div>
  );
}

function filterPages(query: string): DocsPage[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return docsPages;
  }

  return docsPages.filter((page) => {
    const haystack = `${page.title} ${page.description} ${page.body}`.toLowerCase();
    return haystack.includes(normalized);
  });
}
