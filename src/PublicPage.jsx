import React, { useState, useEffect } from 'react';
import { Globe, ChevronRight, FileText } from 'lucide-react';
import { api, label } from './api';
import { PageIcon, Empty } from './ui';
import Editor from './Editor';
import Database from './Database';
export default function PublicPage({ token }) {
  const [data, setData] = useState(null),
    [active, setActive] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    api('/public/' + token)
      .then((data) => {
        setData(data);
        setActive(data.root);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  if (error)
    return (
      <div className="public-shell">
        <Empty icon={Globe} title="Page unavailable">
          {error}
        </Empty>
        <a href="/">Go to your workspace</a>
      </div>
    );
  if (!data) return <div className="loading">Opening shared page…</div>;
  const pages = data.pages.map((p) => ({ ...p, permission: 'view' })),
    page = pages.find((p) => p.id === active) || pages[0],
    parent = pages.find((p) => p.id === page.parent_id);
  return (
    <div className="public-shell">
      <header className="topbar">
        <div className="breadcrumbs">
          {parent && (
            <>
              <button onClick={() => setActive(parent.id)}>
                <PageIcon page={parent} />
                {label(parent)}
              </button>
              <ChevronRight size={14} />
            </>
          )}
          <PageIcon page={page} />
          <span>{label(page)}</span>
        </div>
        <div className="row muted small">
          <Globe size={15} />
          Published page<a href="/">Open workspace</a>
        </div>
      </header>
      <div
        className={'page-cover ' + (page.cover ? 'has-cover' : '')}
        style={{ background: page.cover || undefined }}
      />
      <article
        className={
          'page-document ' + (page.kind === 'database' || page.full_width ? 'full-width' : '')
        }
      >
        {page.icon && <div className="document-icon">{page.icon}</div>}
        <h1 className="page-title">{label(page)}</h1>
        {page.kind === 'database' ? (
          <Database
            page={page}
            pages={pages}
            navigate={setActive}
            reload={async () => {}}
            error={setError}
          />
        ) : (
          <>
            <Editor
              key={page.id}
              page={page}
              reload={async () => {}}
              status={() => {}}
              error={setError}
            />
            <div className="child-pages">
              {pages
                .filter((p) => p.parent_id === page.id)
                .map((p) => (
                  <button key={p.id} onClick={() => setActive(p.id)}>
                    <PageIcon page={p} />
                    <span>{label(p)}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
            </div>
          </>
        )}
      </article>
      <footer className="public-footer">Published with Notion Local · Read-only</footer>
    </div>
  );
}
