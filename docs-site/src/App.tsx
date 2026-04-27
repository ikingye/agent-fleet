import { useEffect, useMemo, useState } from "react";
import {
  buildDocsPages,
  docsGroups,
  docsVersions,
  parseDocsVersion,
  type DocsPage,
  type DocsVersion
} from "./content.js";
import { markdownToHtml } from "./markdown.js";

function currentSlug(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "home";
}

function currentVersion(): DocsVersion {
  return parseDocsVersion(new URLSearchParams(window.location.search).get("version"));
}

function writeVersionToUrl(version: DocsVersion): void {
  const url = new URL(window.location.href);
  if (version === "latest") {
    url.searchParams.delete("version");
  } else {
    url.searchParams.set("version", version);
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function App() {
  const [activeSlug, setActiveSlug] = useState(currentSlug);
  const [docsVersion, setDocsVersion] = useState(currentVersion);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onLocationChange = () => {
      setActiveSlug(currentSlug());
      setDocsVersion(currentVersion());
    };

    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    return () => {
      window.removeEventListener("hashchange", onLocationChange);
      window.removeEventListener("popstate", onLocationChange);
    };
  }, []);

  const docsPages = useMemo(() => buildDocsPages(docsVersion), [docsVersion]);
  const activePage = docsPages.find((page) => page.slug === activeSlug) ?? docsPages[0];
  const activeVersion = docsVersions.find((version) => version.id === docsVersion) ?? docsVersions[0];
  const html = useMemo(() => markdownToHtml(activePage.body), [activePage.body]);
  const visiblePages = useMemo(() => filterPages(query, docsPages), [query, docsPages]);

  useEffect(() => {
    document.title = `${activePage.title} | agent-fleet docs`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activePage]);

  const onVersionChange = (value: string) => {
    const nextVersion = parseDocsVersion(value);
    setDocsVersion(nextVersion);
    writeVersionToUrl(nextVersion);
  };

  return (
    <div className="docs-shell">
      <header className="topbar">
        <div className="header-start">
          <a className="brand" href="#home" aria-label="agent-fleet docs home">
            <img src="logo.svg" alt="" />
            <span>
              <strong>agent-fleet</strong>
              <small>Steward Agent docs</small>
            </span>
          </a>
          <label className="version-picker">
            <span>Version</span>
            <select
              className="version-select"
              aria-label="Documentation version"
              value={docsVersion}
              onChange={(event) => onVersionChange(event.target.value)}
            >
              {docsVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="topnav" aria-label="Primary documentation sections">
          <a href="#getting-started">Start</a>
          <a href="#steward-worker-model">Model</a>
          <a href="#remote-workers">Remote</a>
          <a href="#connectors-security">Security</a>
          <a className="github-link" href="https://github.com/ikingye/agent-fleet" aria-label="GitHub repository">
            GitHub
          </a>
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
            <p className="eyebrow">
              {activePage.group} / {activeVersion.label}
            </p>
            <h1 id="page-title">{activePage.title}</h1>
            <p>{activePage.description}</p>
          </section>

          <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </main>

        <aside className="release-rail" aria-label="Documentation essentials">
          <section>
            <h2>Essentials</h2>
            <a href="#getting-started">Install from source</a>
            <a href="#steward-worker-model">Keep Steward/Worker boundary</a>
            <a href="#connectors-security">Check connector security</a>
            <a href="#remote-workers">Prepare remote prerequisites</a>
            <a href="#v0.1.0-limitations">Current scope and limits</a>
          </section>
          <section>
            <h2>Verify Locally</h2>
            <code>npm run docs:build</code>
            <code>npm run check</code>
            <code>npm run build</code>
          </section>
        </aside>
      </div>
    </div>
  );
}

function filterPages(query: string, docsPages: DocsPage[]): DocsPage[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return docsPages;
  }

  return docsPages.filter((page) => {
    const haystack = `${page.title} ${page.description} ${page.body}`.toLowerCase();
    return haystack.includes(normalized);
  });
}
