import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createLiveClient } from './live';
import {
  Search,
  Home,
  Settings,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  PanelLeft,
  FileText,
  Table2,
  Star,
  MoreHorizontal,
  MessageSquare,
  Clock,
  Copy,
  ArrowUpRight,
  Download,
  FolderInput,
  Lock,
  Users,
  Globe,
  Check,
  LogOut,
  X,
  ExternalLink,
  Smile,
  Image,
  BookOpen,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { api, label, canEdit, escapeHTML } from './api';
import { IconButton, Modal, Field, Empty, PageIcon, Prompt } from './ui';
import Editor from './Editor';
import Database, { Property } from './Database';
import PublicPage from './PublicPage';
import './style.css';
function App() {
  const [user, setUser] = useState(undefined),
    [workspaces, setWorkspaces] = useState([]),
    [workspace, setWorkspace] = useState(localStorage.getItem('workspace') || ''),
    [pages, setPages] = useState([]),
    [page, setPage] = useState(null),
    [route, setRoute] = useState(location.hash.slice(1) || 'home'),
    [modal, setModal] = useState(null),
    [promptSpec, setPromptSpec] = useState(null),
    [toast, setToast] = useState(''),
    [saveStatus, setSaveStatus] = useState('Saved'),
    [sidebar, setSidebar] = useState(innerWidth > 700),
    [presence, setPresence] = useState([]),
    [comments, setComments] = useState(false),
    [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const routeRef = useRef(route),
    workspaceRef = useRef(workspace),
    socket = useRef(),
    pageRef = useRef(page),
    pageQueue = useRef(Promise.resolve()),
    promptResolve = useRef(),
    loadCount = useRef(0);
  routeRef.current = route;
  workspaceRef.current = workspace;
  pageRef.current = page;
  const error = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 8000);
  };
  const prompt = (spec) =>
    new Promise((resolve) => {
      promptResolve.current = resolve;
      setPromptSpec(spec);
    });
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      error(e.message);
    }
  };
  const navigate = async (id) => {
    try {
      await pageQueue.current;
    } catch (e) {
      error(e.message);
      return;
    }
    location.hash = id || 'home';
    setRoute(id || 'home');
    setComments(false);
    if (innerWidth < 700) setSidebar(false);
  };
  const refreshPages = async () => {
    if (workspaceRef.current) setPages(await api('/pages?workspace=' + workspaceRef.current));
  };
  const reload = async () => {
    await pageQueue.current.catch(() => {});
    const id = routeRef.current;
    if (id === 'home' || !id) return;
    const count = ++loadCount.current;
    try {
      const p = await api('/pages/' + id);
      if (routeRef.current === id && count === loadCount.current) {
        setPage(p);
        if (p.workspace_id !== workspaceRef.current) setWorkspace(p.workspace_id);
      }
    } catch (e) {
      if (e.status === 403) {
        setPage(null);
        error(e.message);
      } else throw e;
    }
    await refreshPages();
  };
  const loadWorkspaces = async () => {
    const ws = await api('/workspaces');
    setWorkspaces(ws);
    if (!ws.some((w) => w.id === workspaceRef.current)) setWorkspace(ws[0]?.id || '');
    return ws;
  };
  useEffect(() => {
    api('/me')
      .then(setUser)
      .catch(() => setUser(null));
    const listener = () => setRoute(location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!user) return;
    run(loadWorkspaces);
    socket.current = createLiveClient();
    let timer;
    socket.current.on('invalidate', ({ workspace: w }) => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          run(async () => {
            await loadWorkspaces();
            if (w === workspaceRef.current) {
              await refreshPages();
              await reload();
            }
          }),
        120,
      );
    });
    socket.current.on('presence', setPresence);
    socket.current.on('connect', () => {
      socket.current.emit('page', routeRef.current);
      if (routeRef.current !== 'home') run(reload);
    });
    return () => {
      clearTimeout(timer);
      socket.current.disconnect();
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user || !workspace) return;
    localStorage.setItem('workspace', workspace);
    run(refreshPages);
  }, [workspace, user?.id]);
  useEffect(() => {
    if (!user) return;
    setPage(null);
    setPresence([]);
    if (route !== 'home') run(reload);
    socket.current?.emit('page', route);
  }, [route, user?.id]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setModal('search');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setSidebar((s) => !s);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const patchPage = (changes) => {
    const id = pageRef.current.id;
    const task = pageQueue.current
      .catch(() => {})
      .then(async () => {
        const current = pageRef.current;
        if (current?.id !== id) throw new Error('Page changed before the edit could save.');
        setSaveStatus('Saving…');
        try {
          const result = await api('/pages/' + id, 'PATCH', {
            ...(typeof changes === 'function' ? changes(current) : changes),
            revision: current.revision,
          });
          const next = { ...current, ...result };
          pageRef.current = next;
          setPage(next);
          setPages((list) => list.map((p) => (p.id === id ? { ...p, ...result } : p)));
          setSaveStatus('Saved');
          return result;
        } catch (e) {
          setSaveStatus('Not saved');
          throw e;
        }
      });
    pageQueue.current = task;
    return task;
  };
  const createPage = async (
    kind = 'page',
    parent = null,
    open = true,
    visibility = 'private',
    title = '',
  ) => {
    const result = await api('/pages', 'POST', {
      workspace_id: workspaceRef.current,
      parent_id: parent,
      kind,
      visibility,
      title,
    });
    await refreshPages();
    if (open) navigate(result.id);
    return result.id;
  };
  const w = workspaces.find((w) => w.id === workspace),
    editable = canEdit(page),
    parent = pages.find((p) => p.id === page?.parent_id);
  const ancestors = [];
  let ancestor = parent;
  while (ancestor && ancestors.length < 15) {
    ancestors.unshift(ancestor);
    ancestor = pages.find((p) => p.id === ancestor.parent_id);
  }
  if (route.startsWith('public/')) return <PublicPage token={route.slice(7)} />;
  if (user === undefined) return <div className="loading">Opening your workspace…</div>;
  if (!user) return <Auth onAuth={setUser} />;
  return (
    <div className="app">
      {sidebar && (
        <>
          <aside className="sidebar">
            <div className="workspace-top">
              <button className="workspace-button" onClick={() => setModal('workspaces')}>
                <span className="workspace-avatar">{w?.name?.[0] || user.name[0]}</span>
                <strong>{w?.name || 'Workspace'}</strong>
                <ChevronDown size={14} />
              </button>
              <IconButton title="Close sidebar" onClick={() => setSidebar(false)}>
                <ChevronsLeft size={17} />
              </IconButton>
            </div>
            <nav>
              <button onClick={() => setModal('search')}>
                <Search size={18} />
                Search<span className="shortcut">Ctrl K</span>
              </button>
              <button className={route === 'home' ? 'active' : ''} onClick={() => navigate('home')}>
                <Home size={18} />
                Home
              </button>
            </nav>
            <div className="sidebar-scroll">
              {pages.some((p) => p.favorite) && (
                <>
                  <div className="section-label">Favorites</div>
                  {pages
                    .filter((p) => p.favorite)
                    .map((p) => (
                      <button
                        className={'nav-page ' + (route === p.id ? 'active' : '')}
                        key={p.id}
                        onClick={() => navigate(p.id)}
                      >
                        <PageIcon page={p} />
                        <span>{label(p)}</span>
                      </button>
                    ))}
                </>
              )}
              {['private', 'workspace', 'shared'].map((section) => {
                const roots = pages
                  .filter((p) => !pages.some((x) => x.id === p.parent_id))
                  .filter((p) =>
                    section === 'shared'
                      ? p.owner_id !== user.id && p.visibility !== 'workspace'
                      : section === 'workspace'
                        ? p.visibility === 'workspace'
                        : p.owner_id === user.id && p.visibility === 'private',
                  );
                return (
                  <React.Fragment key={section}>
                    <div className="section-label">
                      <span>
                        {section === 'private'
                          ? 'Private'
                          : section === 'workspace'
                            ? 'Workspace'
                            : 'Shared with me'}
                      </span>
                      {section !== 'shared' && w?.role && (
                        <IconButton
                          title={'Add ' + section + ' page'}
                          onClick={() => run(() => createPage('page', null, true, section))}
                        >
                          <Plus size={14} />
                        </IconButton>
                      )}
                    </div>
                    {roots.map((p) => (
                      <Tree
                        key={p.id}
                        page={p}
                        pages={pages}
                        route={route}
                        navigate={navigate}
                        create={(p) => run(() => createPage('page', p))}
                      />
                    ))}
                    {roots.length === 0 && (
                      <div className="sidebar-empty">
                        {section === 'shared' ? 'Shared pages appear here' : 'No pages yet'}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              {w?.role && (
                <button className="nav-page add-page" onClick={() => run(() => createPage())}>
                  <Plus size={17} />
                  Add a page
                </button>
              )}
            </div>
            <div className="sidebar-bottom">
              <button onClick={() => setModal('settings')}>
                <Settings size={17} />
                Settings & members
              </button>
              <button onClick={() => setModal('trash')}>
                <Trash2 size={17} />
                Trash
              </button>
              <div className="account">
                <span className="avatar">{user.name[0]}</span>
                <span>
                  {user.name}
                  <small>Local workspace</small>
                </span>
                <IconButton
                  title="Log out"
                  onClick={() =>
                    run(async () => {
                      await api('/auth/logout', 'POST');
                      setUser(null);
                      setPages([]);
                      setPage(null);
                      navigate('home');
                    })
                  }
                >
                  <LogOut size={16} />
                </IconButton>
              </div>
            </div>
          </aside>
          <div className="mobile-scrim" onClick={() => setSidebar(false)} />
        </>
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            {!sidebar && (
              <IconButton title="Open sidebar" onClick={() => setSidebar(true)}>
                <PanelLeft size={18} />
              </IconButton>
            )}
            {route === 'home' ? (
              <>
                <Home size={16} />
                <span>Home</span>
              </>
            ) : (
              <>
                {ancestors.map((p) => (
                  <React.Fragment key={p.id}>
                    <button onClick={() => navigate(p.id)}>
                      <PageIcon page={p} />
                      {label(p)}
                    </button>
                    <span className="muted">/</span>
                  </React.Fragment>
                ))}
                <PageIcon page={page} />
                <span>{label(page)}</span>
                {page?.visibility === 'private' && <Lock size={12} className="muted" />}
              </>
            )}
          </div>
          {page && (
            <div className="page-actions">
              <span className={'save-state ' + (saveStatus === 'Not saved' ? 'danger' : '')}>
                {saveStatus}
              </span>
              <div className="presence">
                {presence.map((u) => (
                  <span
                    key={u.id}
                    className="avatar"
                    title={u.name + (u.id === user.id ? ' (you)' : ' — viewing')}
                  >
                    {u.name[0]}
                  </span>
                ))}
              </div>
              <button className="share-button" onClick={() => setModal('share')}>
                Share
              </button>
              <IconButton title="Comments" onClick={() => setComments(!comments)}>
                <MessageSquare size={18} />
              </IconButton>
              <IconButton
                title={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() =>
                  run(async () => {
                    await api(`/pages/${page.id}/favorite`, 'POST', { favorite: !page.favorite });
                    await reload();
                  })
                }
              >
                <Star
                  size={19}
                  fill={page.favorite ? '#e6b456' : 'none'}
                  color={page.favorite ? '#d9a23c' : 'currentColor'}
                />
              </IconButton>
              <IconButton title="Page menu" onClick={() => setModal('page-menu')}>
                <MoreHorizontal size={21} />
              </IconButton>
            </div>
          )}
        </header>
        <div className="content-scroll">
          {route === 'home' ? (
            <HomeScreen
              user={user}
              workspace={w}
              pages={pages}
              navigate={navigate}
              create={(kind, title) => run(() => createPage(kind, null, true, 'private', title))}
            />
          ) : !page ? (
            <Empty title="Page unavailable">
              Choose a page in the sidebar, or ask its owner for access.
            </Empty>
          ) : (
            <>
              <div
                className={'page-cover ' + (page.cover ? 'has-cover' : '')}
                style={{ background: page.cover || undefined }}
              >
                {page.cover && editable && (
                  <button onClick={() => setModal('cover')}>Change cover</button>
                )}
              </div>
              <article
                className={
                  'page-document ' +
                  (page.full_width || page.kind === 'database' ? 'full-width' : '')
                }
              >
                {page.icon && (
                  <button
                    className="document-icon"
                    disabled={!editable}
                    onClick={() => setModal('icon')}
                  >
                    {page.icon}
                  </button>
                )}
                <div className="page-customize">
                  {editable && (
                    <>
                      {!page.icon && (
                        <button onClick={() => setModal('icon')}>
                          <Smile size={14} />
                          Add icon
                        </button>
                      )}
                      {!page.cover && (
                        <button onClick={() => setModal('cover')}>
                          <Image size={14} />
                          Add cover
                        </button>
                      )}
                      <button onClick={() => setComments(true)}>
                        <MessageSquare size={14} />
                        Add comment
                      </button>
                    </>
                  )}
                </div>
                <PageTitle
                  key={'title-' + page.id}
                  title={page.title}
                  editable={editable}
                  save={(value) => run(() => patchPage({ title: value }))}
                />
                {parent?.kind === 'database' && (
                  <div className="page-properties">
                    {parent.config.properties.map((prop) => (
                      <div key={prop.id}>
                        <span>{prop.name}</span>
                        <Property
                          row={page}
                          prop={prop}
                          editable={editable}
                          onChange={(value) =>
                            run(() =>
                              patchPage((current) => ({
                                properties: { ...current.properties, [prop.id]: value },
                              })),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
                {page.kind === 'database' ? (
                  <Database
                    key={'database-' + page.id}
                    page={page}
                    pages={pages}
                    navigate={navigate}
                    createPage={createPage}
                    patchPage={patchPage}
                    reload={reload}
                    error={error}
                    prompt={prompt}
                  />
                ) : (
                  <>
                    <Editor
                      key={'editor-' + page.id}
                      page={page}
                      reload={reload}
                      error={error}
                      status={setSaveStatus}
                      prompt={prompt}
                      createPage={createPage}
                    />
                    <div className="child-pages">
                      {pages
                        .filter((p) => p.parent_id === page.id)
                        .map((p) => (
                          <button key={p.id} onClick={() => navigate(p.id)}>
                            <PageIcon page={p} />
                            <span>{label(p)}</span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                    </div>
                    {editable && (
                      <div className="page-inserts">
                        <button onClick={() => run(() => createPage('page', page.id))}>
                          <FileText size={16} />
                          New sub-page
                        </button>
                        <button onClick={() => run(() => createPage('database', page.id))}>
                          <Table2 size={16} />
                          New database
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            </>
          )}
        </div>
      </main>
      {comments && page && (
        <Comments
          page={page}
          user={user}
          onClose={() => setComments(false)}
          socket={socket.current}
          error={error}
        />
      )}
      {toast && (
        <div className="toast" role="alert">
          <span>{toast}</span>
          <IconButton title="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {promptSpec && (
        <Prompt
          spec={promptSpec}
          onClose={(value) => {
            setPromptSpec(null);
            promptResolve.current(value);
          }}
        />
      )}
      {modal === 'search' && (
        <SearchModal
          workspace={workspace}
          navigate={(id) => {
            navigate(id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'workspaces' && (
        <Modal title="Your workspaces" onClose={() => setModal(null)}>
          <div className="modal-body workspace-list">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWorkspace(w.id);
                  navigate('home');
                  setModal(null);
                }}
              >
                <span className="workspace-avatar">{w.name[0]}</span>
                <span>
                  {w.name}
                  <small>{w.role || 'Guest'}</small>
                </span>
                {w.id === workspace && <Check size={16} />}
              </button>
            ))}
            <button
              onClick={() =>
                run(async () => {
                  setModal(null);
                  const name = await prompt({ title: 'Create workspace', label: 'Workspace name' });
                  if (name) {
                    const result = await api('/workspaces', 'POST', { name });
                    await loadWorkspaces();
                    setWorkspace(result.id);
                    navigate('home');
                  }
                })
              }
            >
              <Plus size={18} />
              Create workspace
            </button>
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <SettingsModal
          workspace={w}
          user={user}
          theme={theme}
          setTheme={setTheme}
          onClose={() => setModal(null)}
          error={error}
          refresh={loadWorkspaces}
        />
      )}
      {modal === 'trash' && (
        <TrashModal
          workspace={workspace}
          onClose={() => setModal(null)}
          reload={refreshPages}
          error={error}
        />
      )}
      {modal === 'share' && page && (
        <ShareModal
          page={page}
          workspace={w}
          refresh={reload}
          onClose={() => setModal(null)}
          patch={patchPage}
          error={error}
        />
      )}
      {modal === 'icon' && (
        <Modal title="Page icon" onClose={() => setModal(null)}>
          <div className="modal-body emoji-grid">
            {'📄 👋 ✨ 💡 📚 📝 🗂️ 🏠 🌱 🎯 🚀 📌 💻 🎨 🧠 ☕ 🌍 🗓️ 📊 🔬 🏗️ 🎵 ❤️ ⭐ 🏖️ 🔖 ✅ 🛠️'
              .split(' ')
              .map((icon) => (
                <button
                  key={icon}
                  onClick={() =>
                    run(async () => {
                      await patchPage({ icon });
                      setModal(null);
                    })
                  }
                >
                  {icon}
                </button>
              ))}
          </div>
          <footer>
            <button
              onClick={() =>
                run(async () => {
                  await patchPage({ icon: '' });
                  setModal(null);
                })
              }
            >
              Remove icon
            </button>
          </footer>
        </Modal>
      )}
      {modal === 'cover' && (
        <Modal title="Page cover" onClose={() => setModal(null)}>
          <div className="modal-body cover-grid">
            {[
              '#e5d3c1',
              '#d9e5d6',
              '#d8e2ec',
              '#e6d4da',
              '#f1dbaf',
              '#c8c2dc',
              '#dedbd5',
              '#343d48',
              '#aac4bd',
            ].map((cover) => (
              <button
                aria-label={'Cover ' + cover}
                key={cover}
                style={{ background: cover }}
                onClick={() =>
                  run(async () => {
                    await patchPage({ cover });
                    setModal(null);
                  })
                }
              />
            ))}
          </div>
          <footer>
            <button
              onClick={() =>
                run(async () => {
                  await patchPage({ cover: '' });
                  setModal(null);
                })
              }
            >
              Remove cover
            </button>
          </footer>
        </Modal>
      )}
      {modal === 'page-menu' && (
        <Modal title="Page actions" onClose={() => setModal(null)}>
          <div className="modal-body action-list">
            {editable && (
              <button onClick={() => run(() => patchPage({ full_width: !page.full_width }))}>
                <ArrowUpRight size={17} />
                Full width<span className="push">{page.full_width ? 'On' : 'Off'}</span>
              </button>
            )}
            <button
              onClick={() =>
                run(async () => {
                  const result = await api(`/pages/${page.id}/duplicate`, 'POST');
                  setModal(null);
                  await refreshPages();
                  navigate(result.id);
                })
              }
            >
              <Copy size={17} />
              Duplicate page & sub-pages
            </button>
            {page.permission === 'owner' && (
              <button onClick={() => setModal('move')}>
                <FolderInput size={17} />
                Move to
              </button>
            )}
            <button
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(location.href);
                  setModal(null);
                  error('Page link copied');
                })
              }
            >
              <ExternalLink size={17} />
              Copy link
            </button>
            <button
              onClick={() =>
                run(async () => {
                  const response = await fetch(`/api/pages/${page.id}/export`);
                  if (!response.ok) throw new Error('Export failed');
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = label(page) + '.md';
                  a.click();
                  URL.revokeObjectURL(url);
                  setModal(null);
                })
              }
            >
              <Download size={17} />
              Export Markdown
            </button>
            {editable && (
              <>
                <button onClick={() => setModal('import')}>
                  <Download size={17} />
                  Import Markdown
                </button>
                <button onClick={() => setModal('history')}>
                  <Clock size={17} />
                  Page history
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/pages/${page.id}/trash`, 'POST', {});
                      setModal(null);
                      await refreshPages();
                      navigate('home');
                    })
                  }
                >
                  <Trash2 size={17} />
                  Move to trash
                </button>
              </>
            )}
            <p className="small muted">Last edited {new Date(page.updated_at).toLocaleString()}</p>
          </div>
        </Modal>
      )}
      {modal === 'move' && (
        <Modal title="Move page to" onClose={() => setModal(null)}>
          <div className="modal-body action-list">
            <button
              onClick={() =>
                run(async () => {
                  await patchPage({ parent_id: null });
                  setModal(null);
                })
              }
            >
              <Home size={17} />
              Workspace top level
            </button>
            {pages
              .filter((p) => p.id !== page.id && canEdit(p))
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() =>
                    run(async () => {
                      await patchPage({ parent_id: p.id });
                      setModal(null);
                    })
                  }
                >
                  <PageIcon page={p} />
                  {label(p)}
                </button>
              ))}
          </div>
        </Modal>
      )}
      {modal === 'import' && (
        <ImportModal page={page} onClose={() => setModal(null)} reload={reload} error={error} />
      )}
      {modal === 'history' && (
        <HistoryModal page={page} reload={reload} onClose={() => setModal(null)} error={error} />
      )}
    </div>
  );
}
function PageTitle({ title, editable, save }) {
  const ref = useRef(),
    timer = useRef(),
    saved = useRef(title);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = title;
      saved.current = title;
    }
  }, [title]);
  const flush = () => {
    clearTimeout(timer.current);
    const value = ref.current?.textContent || '';
    if (value !== saved.current) {
      saved.current = value;
      save(value);
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <h1
      ref={ref}
      contentEditable={editable}
      suppressContentEditableWarning
      className="page-title"
      role="textbox"
      aria-label="Page title"
      data-placeholder="Untitled"
      onInput={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 650);
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
          document.querySelector('.block-content')?.focus();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand(
          'insertText',
          false,
          e.clipboardData.getData('text/plain').replaceAll('\n', ' '),
        );
      }}
    />
  );
}
function Tree({ page, pages, route, navigate, create, depth = 0 }) {
  const [expanded, setExpanded] = useState(true),
    children = pages.filter((p) => p.parent_id === page.id);
  return (
    <>
      <div
        className={'tree-row ' + (route === page.id ? 'active' : '')}
        style={{ paddingLeft: 8 + depth * 13 }}
      >
        <IconButton
          title={(expanded ? 'Collapse ' : 'Expand ') + label(page)}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : '' }} />
        </IconButton>
        <button className="tree-title" onClick={() => navigate(page.id)}>
          <PageIcon page={page} />
          <span>{label(page)}</span>
        </button>
        {canEdit(page) && (
          <IconButton title={'Add sub-page to ' + label(page)} onClick={() => create(page.id)}>
            <Plus size={14} />
          </IconButton>
        )}
      </div>
      {expanded &&
        depth < 20 &&
        children.map((p) => (
          <Tree
            key={p.id}
            page={p}
            pages={pages}
            route={route}
            navigate={navigate}
            create={create}
            depth={depth + 1}
          />
        ))}
    </>
  );
}
function Auth({ onAuth }) {
  const [register, setRegister] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <a className="auth-brand" href="#">
        <span className="notion-logo">N</span>Notion <span className="muted">Local</span>
      </a>
      <div className="auth-card">
        <div className="auth-illustration">✳</div>
        <h1>
          Your ideas.
          <br />A place to call home.
        </h1>
        <p className="muted">Write, plan, and make room for what matters.</p>
        <div className="auth-tabs">
          <button
            className={register ? 'active' : ''}
            onClick={() => {
              setRegister(true);
              setError('');
            }}
          >
            Create account
          </button>
          <button
            className={!register ? 'active' : ''}
            onClick={() => {
              setRegister(false);
              setError('');
            }}
          >
            Log in
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const data = Object.fromEntries(new FormData(e.currentTarget));
              onAuth(await api('/auth/' + (register ? 'register' : 'login'), 'POST', data));
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <Field label="Your name">
              <input
                name="name"
                placeholder="Ada Lovelace"
                autoComplete="name"
                required
                maxLength={80}
              />
            </Field>
          )}
          <Field label="Email">
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={200}
              placeholder="At least 8 characters"
              autoComplete={register ? 'new-password' : 'current-password'}
              required
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create your workspace' : 'Continue with email'}
          </button>
        </form>
        <p className="auth-note">
          Local accounts. Your data stays on this server.
          <br />
          An independent, open-source Notion recreation.
        </p>
      </div>
    </div>
  );
}
function HomeScreen({ user, workspace, pages, navigate, create }) {
  const hour = new Date().getHours();
  return (
    <div className="home-screen">
      <div className="home-greeting">
        <span className="home-sun">☀</span>
        <h1>
          Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'},{' '}
          {user.name.split(' ')[0]}
        </h1>
        <p>A little space for your next big idea.</p>
      </div>
      <section>
        <h3>
          <Clock size={16} />
          Recently edited
        </h3>
        <div className="recent-grid">
          {[...pages]
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, 6)
            .map((p) => (
              <button className="recent-card" key={p.id} onClick={() => navigate(p.id)}>
                <div className="recent-cover" style={{ background: p.cover || undefined }}>
                  <span>{p.icon || (p.kind === 'database' ? '▦' : '▤')}</span>
                </div>
                <strong>{label(p)}</strong>
                <small>
                  {new Date(p.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  · {p.visibility === 'private' ? 'Private' : 'Workspace'}
                </small>
              </button>
            ))}
        </div>
        {pages.length === 0 && <Empty title="A fresh start">Create your first page below.</Empty>}
      </section>
      {workspace?.role && (
        <section>
          <h3>
            <Plus size={16} />
            Start something new
          </h3>
          <div className="starter-grid">
            <button onClick={() => create('page', '')}>
              <FileText size={24} />
              <strong>Empty page</strong>
              <span>A blank canvas for your thoughts</span>
              <ArrowUpRight size={17} />
            </button>
            <button onClick={() => create('database', 'Projects')}>
              <Table2 size={24} />
              <strong>Database</strong>
              <span>Bring structure to your projects</span>
              <ArrowUpRight size={17} />
            </button>
          </div>
        </section>
      )}
      <div className="home-tip">
        <span>✧</span>
        <div>
          <strong>Make yourself at home</strong>
          <p>
            Open a page and type <kbd>/</kbd> to add headings, lists, to-dos, and more.
            <br />
            Find anything in your workspace with <kbd>Ctrl</kbd> + <kbd>K</kbd>.
          </p>
        </div>
      </div>
    </div>
  );
}
function SearchModal({ workspace, navigate, onClose }) {
  const [q, setQ] = useState(''),
    [results, setResults] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api('/search?workspace=' + workspace + '&q=' + encodeURIComponent(q))
          .then((r) => active && setResults(r))
          .catch((e) => setError(e.message)),
      150,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, workspace]);
  return (
    <Modal title="Search" onClose={onClose} wide>
      <div className="search-input">
        <Search size={21} />
        <input
          autoFocus
          placeholder="Search pages and content…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="search-results">
        {results.map((p) => (
          <button key={p.id} onClick={() => navigate(p.id)}>
            <PageIcon page={p} />
            <span>
              {label(p)}
              <small>{new Date(p.updated_at).toLocaleDateString()}</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {!results.length && (
          <Empty icon={Search} title="No results">
            Try a different search.
          </Empty>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer>
        <small className="muted">Searches titles and block content · Esc to close</small>
      </footer>
    </Modal>
  );
}
function ShareModal({ page, workspace, onClose, patch, error, refresh }) {
  const [shares, setShares] = useState([]),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('edit'),
    [publicToken, setPublicToken] = useState(page.public_token),
    [publicEnabled, setPublicEnabled] = useState(!!page.public_token);
  const owner = page.permission === 'owner';
  const load = () =>
    owner &&
    api(`/pages/${page.id}/shares`)
      .then(setShares)
      .catch((e) => error(e.message));
  useEffect(() => {
    load();
  }, [page.id]);
  return (
    <Modal title="Share this page" onClose={onClose}>
      <div className="modal-body">
        {owner ? (
          <>
            <form
              className="invite-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/pages/${page.id}/shares`, 'POST', { email, role });
                  setEmail('');
                  load();
                } catch (e) {
                  error(e.message);
                }
              }}
            >
              <input
                type="email"
                aria-label="Invite email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <select
                aria-label="Permission"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="edit">Can edit</option>
                <option value="comment">Can comment</option>
                <option value="view">Can view</option>
              </select>
              <button className="primary">Invite</button>
            </form>
            <p className="small muted">
              Invite someone with an existing local account. Access also applies to sub-pages.
            </p>
            {shares.map((s) => (
              <div className="member-row" key={s.id}>
                <span className="avatar">{s.name[0]}</span>
                <span>
                  {s.name}
                  <small>{s.email}</small>
                </span>
                <select
                  aria-label={'Permission for ' + s.name}
                  value={s.role}
                  onChange={async (e) => {
                    try {
                      await api(`/pages/${page.id}/shares`, 'POST', {
                        email: s.email,
                        role: e.target.value,
                      });
                      load();
                    } catch (e) {
                      error(e.message);
                    }
                  }}
                >
                  <option value="edit">Can edit</option>
                  <option value="comment">Can comment</option>
                  <option value="view">Can view</option>
                </select>
                <IconButton
                  title={'Remove access for ' + s.name}
                  onClick={async () => {
                    try {
                      await api(`/pages/${page.id}/shares/${s.id}`, 'DELETE');
                      load();
                    } catch (e) {
                      error(e.message);
                    }
                  }}
                >
                  <X size={15} />
                </IconButton>
              </div>
            ))}
            <hr />
            <div className="general-access">
              <Lock size={18} />
              <div>
                <strong>General access</strong>
                <small>Parent page access is inherited.</small>
              </div>
              <select
                aria-label="General access"
                value={page.visibility}
                onChange={(e) =>
                  patch({ visibility: e.target.value }).catch((e) => error(e.message))
                }
              >
                <option value="private">Invited people only</option>
                <option value="workspace">Workspace members</option>
              </select>
            </div>
            <hr />
            <div className="publish-setting">
              <div>
                <Globe size={18} />
                <strong>Publish to the web</strong>
              </div>
              <label className="row">
                <input
                  aria-label="Publish to the web"
                  type="checkbox"
                  checked={publicEnabled}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setPublicEnabled(enabled);
                    try {
                      const result = await api('/pages/' + page.id + '/publish', 'POST', {
                        enabled,
                      });
                      setPublicToken(result.token);
                      await refresh();
                    } catch (e) {
                      setPublicEnabled(!enabled);
                      error(e.message);
                    }
                  }}
                />
                Anyone with the link can view
              </label>
              <p className="small muted">
                Publishing includes this page, its sub-pages, and database records. Visitors cannot
                edit or comment.
              </p>
              {publicToken && (
                <div className="row">
                  <input
                    aria-label="Public link"
                    readOnly
                    value={location.origin + '/#public/' + publicToken}
                  />
                  <button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(location.origin + '/#public/' + publicToken)
                        .then(() => error('Public link copied'))
                        .catch((e) => error(e.message))
                    }
                  >
                    Copy
                  </button>
                  <a href={'/#public/' + publicToken} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              )}
            </div>
          </>
        ) : (
          <p>
            Your access: <strong>Can {page.permission}</strong>. Only a page owner can change
            sharing.
          </p>
        )}
      </div>
      <footer>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href);
              error('Page link copied');
            } catch (e) {
              error(e.message);
            }
          }}
        >
          <ExternalLink size={15} />
          Copy link
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Modal>
  );
}
function Comments({ page, user, onClose, socket, error }) {
  const [items, setItems] = useState([]),
    [body, setBody] = useState(''),
    [resolved, setResolved] = useState(false);
  const load = () =>
    api(`/pages/${page.id}/comments`)
      .then(setItems)
      .catch((e) => error(e.message));
  useEffect(() => {
    load();
    const fn = ({ page: p }) => p === page.id && load();
    socket?.on('invalidate', fn);
    return () => socket?.off('invalidate', fn);
  }, [page.id]);
  return (
    <aside className="comments-panel">
      <header>
        <h3>Comments</h3>
        <IconButton title="Close comments" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <label className="resolved-toggle">
        <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />
        Show resolved
      </label>
      <div className="comments-list">
        {items
          .filter((c) => resolved || !c.resolved)
          .map((c) => (
            <div className={'comment ' + (c.resolved ? 'resolved' : '')} key={c.id}>
              <div className="row">
                <span className="avatar">{c.name[0]}</span>
                <strong>{c.name}</strong>
                {(c.user_id === user.id || canEdit(page)) && (
                  <IconButton
                    title={c.resolved ? 'Reopen comment' : 'Resolve comment'}
                    onClick={async () => {
                      try {
                        await api(`/pages/${page.id}/comments/${c.id}`, 'PATCH', {
                          resolved: !c.resolved,
                        });
                        load();
                      } catch (e) {
                        error(e.message);
                      }
                    }}
                  >
                    <Check size={15} />
                  </IconButton>
                )}
              </div>
              <p>{c.body}</p>
              <small className="muted">{new Date(c.created_at).toLocaleString()}</small>
            </div>
          ))}
        {!items.filter((c) => resolved || !c.resolved).length && (
          <Empty icon={MessageSquare} title="Start a conversation">
            Keep the discussion close to the work.
          </Empty>
        )}
      </div>
      {page.permission !== 'view' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/pages/${page.id}/comments`, 'POST', { body });
              setBody('');
              load();
            } catch (e) {
              error(e.message);
            }
          }}
        >
          <textarea
            aria-label="Write a comment"
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={5000}
          />
          <button className="primary">Send</button>
        </form>
      )}
    </aside>
  );
}
function SettingsModal({ workspace, user, theme, setTheme, onClose, error, refresh }) {
  const [members, setMembers] = useState([]),
    [name, setName] = useState(workspace?.name || '');
  const owner = workspace?.owner_id === user.id;
  const load = () =>
    workspace?.role &&
    api(`/workspaces/${workspace.id}/members`)
      .then(setMembers)
      .catch((e) => error(e.message));
  useEffect(() => {
    load();
  }, [workspace?.id]);
  return (
    <Modal title="Settings & members" onClose={onClose} wide>
      <div className="modal-body">
        <div className="settings-account">
          <span className="avatar large">{user.name[0]}</span>
          <div>
            <strong>{user.name}</strong>
            <p className="muted">{user.email}</p>
          </div>
        </div>
        <Field label="Appearance">
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/workspaces/${workspace.id}`, 'PATCH', { name });
              await refresh();
              error('Workspace updated');
            } catch (e) {
              error(e.message);
            }
          }}
        >
          <Field label="Workspace name">
            <div className="row">
              <input
                value={name}
                disabled={!owner}
                onChange={(e) => setName(e.target.value)}
                required
              />
              {owner && <button className="primary">Save</button>}
            </div>
          </Field>
        </form>
        <h3>Members</h3>
        {members.map((m) => (
          <div className="member-row" key={m.id}>
            <span className="avatar">{m.name[0]}</span>
            <span>
              {m.name}
              <small>{m.email}</small>
            </span>
            <span className="muted push">{m.role}</span>
            {owner && m.id !== user.id && (
              <IconButton
                title={'Remove member ' + m.name}
                onClick={async () => {
                  try {
                    await api(`/workspaces/${workspace.id}/members/${m.id}`, 'DELETE');
                    load();
                  } catch (e) {
                    error(e.message);
                  }
                }}
              >
                <X size={16} />
              </IconButton>
            )}
          </div>
        ))}
        {owner && (
          <form
            className="invite-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              try {
                await api(`/workspaces/${workspace.id}/members`, 'POST', {
                  email: new FormData(form).get('email'),
                });
                form.reset();
                load();
              } catch (e) {
                error(e.message);
              }
            }}
          >
            <input
              name="email"
              aria-label="Member email"
              type="email"
              placeholder="Add a member by email"
              required
            />
            <button className="primary">Add member</button>
          </form>
        )}
        <p className="small muted">
          Members can edit workspace-visible pages. Private pages remain private. New members must
          create an account on this server first.
        </p>
      </div>
    </Modal>
  );
}
function TrashModal({ workspace, onClose, reload, error }) {
  const [items, setItems] = useState([]);
  const load = () =>
    api(`/pages?workspace=${workspace}&trash=1`)
      .then(setItems)
      .catch((e) => error(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <Modal title="Trash" onClose={onClose}>
      <div className="modal-body">
        {items.map((p) => (
          <div className="trash-row" key={p.id}>
            <PageIcon page={p} />
            <span>{label(p)}</span>
            {canEdit(p) && (
              <button
                onClick={async () => {
                  try {
                    await api(`/pages/${p.id}/trash`, 'POST', { restore: true });
                    load();
                    reload();
                  } catch (e) {
                    error(e.message);
                  }
                }}
              >
                <RefreshCw size={14} />
                Restore
              </button>
            )}
          </div>
        ))}
        {!items.length && (
          <Empty icon={Trash2} title="Trash is empty">
            Deleted pages can be restored here.
          </Empty>
        )}
      </div>
    </Modal>
  );
}
function HistoryModal({ page, onClose, reload, error }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api(`/pages/${page.id}/versions`)
      .then(setItems)
      .catch((e) => error(e.message));
  }, [page.id]);
  return (
    <Modal title="Page history" onClose={onClose}>
      <div className="modal-body history-list">
        <p className="small muted">
          Restore a previous title and block snapshot. The latest 50 snapshots are kept. Database
          records and settings are not included.
        </p>
        {items.map((v) => (
          <div className="history-row" key={v.id}>
            <Clock size={17} />
            <span>
              {new Date(v.created_at).toLocaleString()}
              <small>{v.name}</small>
            </span>
            <button
              onClick={async () => {
                try {
                  await api(`/pages/${page.id}/versions/${v.id}`, 'POST');
                  await reload();
                  onClose();
                } catch (e) {
                  error(e.message);
                }
              }}
            >
              Restore
            </button>
          </div>
        ))}
        {!items.length && (
          <Empty icon={Clock} title="No history yet">
            Snapshots are created as you edit blocks.
          </Empty>
        )}
      </div>
    </Modal>
  );
}
function ImportModal({ page, onClose, reload, error }) {
  const [markdown, setMarkdown] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Import Markdown" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api('/pages/' + page.id + '/import', 'POST', { markdown });
            await reload();
            onClose();
          } catch (e) {
            error(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="small muted">
            Append headings, text, lists, tasks, quotes, dividers, and fenced code from a Markdown
            file. Existing blocks stay in place.
          </p>
          <Field label="Markdown file">
            <input
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              onChange={async (e) => {
                const file = e.target.files[0];
                if (file) {
                  if (file.size > 500000) {
                    error('Choose a file smaller than 500 KB.');
                    return;
                  }
                  setMarkdown(await file.text());
                }
              }}
            />
          </Field>
          <Field label="Markdown content">
            <textarea
              rows={10}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              required
              maxLength={500000}
            />
          </Field>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById('root')).render(<App />);
