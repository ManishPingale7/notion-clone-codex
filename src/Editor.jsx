import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  GripVertical,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  SquareCheck,
  ChevronRight,
  Quote,
  Minus,
  Code,
  Lightbulb,
  Image,
  Link,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  FileText,
  Table2,
} from 'lucide-react';
import { api, canEdit, plain, escapeHTML } from './api';
import { IconButton } from './ui';
const types = [
  ['text', 'Text', Type, 'Just start writing with plain text.'],
  ['heading1', 'Heading 1', Heading1, 'Big section heading.'],
  ['heading2', 'Heading 2', Heading2, 'Medium section heading.'],
  ['heading3', 'Heading 3', Heading3, 'Small section heading.'],
  ['todo', 'To-do list', SquareCheck, 'Keep track of tasks.'],
  ['bullet', 'Bulleted list', List, 'Create a simple bulleted list.'],
  ['number', 'Numbered list', ListOrdered, 'Create a list with numbering.'],
  ['toggle', 'Toggle list', ChevronRight, 'Hide or show a line of content.'],
  ['quote', 'Quote', Quote, 'Capture a quote.'],
  ['callout', 'Callout', Lightbulb, 'Make something stand out.'],
  ['divider', 'Divider', Minus, 'Visually divide blocks.'],
  ['code', 'Code', Code, 'Capture a code snippet.'],
  ['image', 'Image', Image, 'Display an image from a URL.'],
  ['bookmark', 'Web bookmark', Link, 'Save a link to a website.'],
  ['page', 'Page', FileText, 'Add a nested page.'],
  ['database', 'Database', Table2, 'Organize a collection of pages.'],
];
export default function Editor({ page, reload, error, status, prompt, createPage }) {
  const editable = canEdit(page),
    [menu, setMenu] = useState(null),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0),
    [format, setFormat] = useState(null),
    [drag, setDrag] = useState(null),
    [collapsed, setCollapsed] = useState(new Set());
  const root = useRef();
  const focus = (id) =>
    setTimeout(() => {
      const el = document.querySelector(`[data-block="${id}"] .block-content`);
      el?.focus();
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
      }
    }, 50);
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      error(e.message);
    }
  };
  const add = async (after, type = 'text', html = '', indent = 0) => {
    const b = await api(`/pages/${page.id}/blocks`, 'POST', { after, type, html, indent });
    await reload();
    focus(b.id);
    return b;
  };
  const remove = async (b) => {
    await api(`/pages/${page.id}/blocks/${b.id}`, 'DELETE');
    await reload();
  };
  const patch = async (b, data) => {
    const updated = await api(`/pages/${page.id}/blocks/${b.id}`, 'PATCH', {
      ...data,
      revision: b.revision,
    });
    window.dispatchEvent(new CustomEvent('block-replaced', { detail: updated }));
    await reload();
    return updated;
  };
  const choose = async (type) => {
    const b = menu.block;
    setMenu(null);
    setQuery('');
    if (type === 'page' || type === 'database') {
      await createPage(type, page.id);
      return;
    }
    let html = menu.slash ? '' : b.html;
    if (type === 'image' || type === 'bookmark') {
      const url = await prompt({
        title: type === 'image' ? 'Embed image' : 'Add a web bookmark',
        label: 'URL',
        placeholder: 'https://…',
      });
      if (url === null) return;
      if (!/^https?:\/\//i.test(url)) {
        error('Enter an http or https URL.');
        return;
      }
      html = escapeHTML(url);
    }
    await patch(b, { type, html });
    focus(b.id);
  };
  const reorder = async (from, to) => {
    const ids = page.blocks.map((b) => b.id);
    ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(to), 0, from);
    await api(`/pages/${page.id}/reorder`, 'POST', { ids });
    await reload();
  };
  useEffect(() => {
    const handler = (e) => {
      const selection = window.getSelection();
      if (selection?.isCollapsed || !root.current?.contains(selection?.anchorNode)) {
        setFormat(null);
        return;
      }
      const r = selection.getRangeAt(0).getBoundingClientRect();
      setFormat({ top: r.top - 42, left: Math.max(10, Math.min(r.left, window.innerWidth - 280)) });
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, []);
  const hidden = new Set();
  let hiddenIndent = null;
  for (const b of page.blocks) {
    if (hiddenIndent !== null && b.indent > hiddenIndent) hidden.add(b.id);
    else hiddenIndent = null;
    if (collapsed.has(b.id) && b.type === 'toggle' && !hidden.has(b.id)) hiddenIndent = b.indent;
  }
  const filtered = types.filter((t) =>
    (t[0] + ' ' + t[1]).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="editor"
      ref={root}
      onKeyDown={(e) => {
        if (menu && menu.slash) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected(
              (s) => (s + (e.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length,
            );
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            run(() => choose(filtered[selected]?.[0] || 'text'));
          }
          if (e.key === 'Escape') {
            setMenu(null);
          }
        }
      }}
    >
      {page.blocks
        .filter((b) => !hidden.has(b.id))
        .map((b, index) => (
          <Block
            key={b.id}
            block={b}
            pageId={page.id}
            editable={editable}
            expanded={!collapsed.has(b.id)}
            onToggle={() =>
              setCollapsed((old) => {
                const next = new Set(old);
                if (next.has(b.id)) next.delete(b.id);
                else next.add(b.id);
                return next;
              })
            }
            status={status}
            error={error}
            refresh={reload}
            slashOpen={menu?.slash && menu.block.id === b.id}
            onSlash={(q, rect) => {
              setMenu({
                block: b,
                slash: true,
                top: Math.min(rect.bottom + 5, window.innerHeight - 340),
                left: Math.min(rect.left, window.innerWidth - 330),
              });
              setQuery(q);
              setSelected(0);
            }}
            onCloseSlash={() => setMenu(null)}
            onEnter={(html = '') =>
              run(() =>
                add(
                  b.id,
                  ['bullet', 'number', 'todo'].includes(b.type) ? b.type : 'text',
                  html,
                  b.indent + (b.type === 'toggle' ? 1 : 0),
                ),
              )
            }
            onEmptyBackspace={() =>
              index > 0 &&
              run(async () => {
                await remove(b);
                focus(page.blocks[index - 1].id);
              })
            }
            onMenu={(rect) => {
              setQuery('');
              setSelected(0);
              setMenu({
                block: b,
                top: Math.min(rect.bottom, window.innerHeight - 440),
                left: Math.max(10, rect.left),
              });
            }}
            onAdd={() => run(() => add(b.id))}
            drag={drag}
            onDragStart={() => setDrag(b.id)}
            onDrop={() => drag && drag !== b.id && run(() => reorder(drag, b.id))}
            number={(() => {
              let n = 1;
              for (let i = page.blocks.indexOf(b) - 1; i >= 0; i--) {
                const prev = page.blocks[i];
                if (prev.indent < b.indent || (prev.indent === b.indent && prev.type !== 'number'))
                  break;
                if (prev.indent === b.indent && prev.type === 'number') n++;
              }
              return n;
            })()}
          />
        ))}
      {editable && (
        <button className="add-block" onClick={() => run(() => add(page.blocks.at(-1)?.id))}>
          <Plus size={16} /> Click to add a block, or press Enter
        </button>
      )}
      {menu && (
        <>
          <div className="menu-dismiss" onClick={() => setMenu(null)} />
          <div className="block-menu floating" style={{ top: menu.top, left: menu.left }}>
            <div className="menu-label">{menu.slash ? 'BASIC BLOCKS' : 'TURN INTO'}</div>
            <div className="block-menu-scroll">
              {filtered.map(([type, name, Icon, description], i) => (
                <button
                  key={type}
                  className={selected === i ? 'selected' : ''}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(() => choose(type))}
                >
                  <span className="block-preview">
                    <Icon size={21} />
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </div>
            {!menu.slash && (
              <div className="menu-actions">
                <button
                  onClick={() =>
                    run(async () => {
                      setMenu(null);
                      await add(menu.block.id, menu.block.type, menu.block.html);
                    })
                  }
                >
                  <Copy size={16} />
                  Duplicate
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    run(async () => {
                      setMenu(null);
                      await remove(menu.block);
                    })
                  }
                >
                  <Trash2 size={16} />
                  Delete
                </button>
                <div className="row">
                  <button
                    onClick={() =>
                      run(async () => {
                        const i = page.blocks.findIndex((b) => b.id === menu.block.id);
                        if (i > 0) await reorder(menu.block.id, page.blocks[i - 1].id);
                        setMenu(null);
                      })
                    }
                  >
                    <ArrowUp size={15} />
                    Move up
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        const ids = page.blocks.map((b) => b.id),
                          i = ids.indexOf(menu.block.id);
                        if (i < ids.length - 1) {
                          [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                          await api(`/pages/${page.id}/reorder`, 'POST', { ids });
                          await reload();
                        }
                        setMenu(null);
                      })
                    }
                  >
                    <ArrowDown size={15} />
                    Move down
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {editable && format && (
        <div
          className="format-toolbar floating"
          style={format}
          onMouseDown={(e) => e.preventDefault()}
        >
          {[
            ['bold', Bold],
            ['italic', Italic],
            ['underline', Underline],
            ['strikeThrough', Strikethrough],
          ].map(([command, Icon]) => (
            <IconButton key={command} title={command} onClick={() => document.execCommand(command)}>
              <Icon size={16} />
            </IconButton>
          ))}
          <IconButton
            title="Add link"
            onClick={async () => {
              const selection = window.getSelection();
              const range = selection.getRangeAt(0).cloneRange();
              const url = await prompt({ title: 'Add link', label: 'URL' });
              if (url && /^https?:\/\//i.test(url)) {
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand('createLink', false, url);
              }
            }}
          >
            <Link size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function Block({
  block: b,
  pageId,
  editable,
  expanded,
  onToggle,
  status,
  error,
  refresh,
  onSlash,
  onCloseSlash,
  slashOpen,
  onEnter,
  onEmptyBackspace,
  onMenu,
  onAdd,
  onDragStart,
  onDrop,
  number,
}) {
  const initialized = useRef(false),
    ref = useRef(),
    revision = useRef(b.revision),
    saved = useRef(b.html),
    timer = useRef(),
    busy = useRef(null),
    [checked, setChecked] = useState(!!b.checked),
    [conflict, setConflict] = useState(false);
  useEffect(() => setChecked(!!b.checked), [b.checked]);
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!ref.current || !editable || !initialized.current) return true;
    if (busy.current) {
      const ok = await busy.current;
      if (!ok) return false;
      return save();
    }
    const html = ref.current.innerHTML;
    if (html === saved.current) return true;
    status('Saving…');
    busy.current = (async () => {
      try {
        const result = await api(`/pages/${pageId}/blocks/${b.id}`, 'PATCH', {
          html,
          revision: revision.current,
        });
        revision.current = result.revision;
        saved.current = html;
        status('Saved');
        setConflict(false);
        return true;
      } catch (e) {
        setConflict(true);
        status('Not saved');
        error(e.message);
        return false;
      }
    })();
    const ok = await busy.current;
    busy.current = null;
    return ok;
  }, [pageId, b.id, editable]);
  useEffect(() => {
    if (ref.current && b.revision >= revision.current) {
      if (!initialized.current || ref.current.innerHTML === saved.current) {
        initialized.current = true;
        ref.current.innerHTML = b.html;
        saved.current = b.html;
        revision.current = b.revision;
      } else if (b.revision > revision.current && !busy.current) {
        setConflict(true);
      }
    }
  }, [b.html, b.revision, b.type]);
  useEffect(() => {
    const handler = (e) => {
      const next = e.detail;
      if (next.id !== b.id) return;
      clearTimeout(timer.current);
      if (ref.current) ref.current.innerHTML = next.html;
      saved.current = next.html;
      revision.current = next.revision;
      setConflict(false);
    };
    window.addEventListener('block-replaced', handler);
    return () => window.removeEventListener('block-replaced', handler);
  }, [b.id]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      save();
    },
    [save],
  );
  const changed = () => {
    const value = ref.current.textContent;
    if (value.startsWith('/')) {
      onSlash(value.slice(1), ref.current.getBoundingClientRect());
    } else {
      if (slashOpen) onCloseSlash();
      status('Saving…');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, 650);
    }
  };
  const keys = async (e) => {
    if (slashOpen && ['Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return;
    if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code') {
      e.preventDefault();
      const selection = window.getSelection();
      let tail = '';
      if (selection.rangeCount && ref.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0).cloneRange();
        range.deleteContents();
        range.setEnd(ref.current, ref.current.childNodes.length);
        const container = document.createElement('div');
        container.appendChild(range.extractContents());
        tail = container.innerHTML;
      }
      if (await save()) onEnter(tail);
    }
    if (e.key === 'Backspace' && !ref.current.textContent) {
      e.preventDefault();
      onEmptyBackspace();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      try {
        if (!(await save())) return;
        const next = await api(`/pages/${pageId}/blocks/${b.id}`, 'PATCH', {
          indent: b.indent + (e.shiftKey ? -1 : 1),
          revision: revision.current,
        });
        revision.current = next.revision;
        await refresh();
      } catch (e) {
        error(e.message);
      }
    }
    if (e.key === ' ') {
      const value = ref.current.textContent;
      const type = {
        '#': 'heading1',
        '##': 'heading2',
        '###': 'heading3',
        '-': 'bullet',
        '1.': 'number',
        '[]': 'todo',
        '>': 'quote',
        '---': 'divider',
      }[value];
      if (type) {
        e.preventDefault();
        clearTimeout(timer.current);
        try {
          const next = await api(`/pages/${pageId}/blocks/${b.id}`, 'PATCH', {
            type,
            html: '',
            revision: revision.current,
          });
          revision.current = next.revision;
          saved.current = '';
          ref.current.innerHTML = '';
          await refresh();
        } catch (e) {
          error(e.message);
        }
      }
    }
  };
  const url = plain(b.html),
    safe = /^https?:\/\//i.test(url);
  return (
    <div
      data-block={b.id}
      className={
        'block block-' + b.type + (b.checked ? ' checked' : '') + (conflict ? ' conflict' : '')
      }
      style={{ marginLeft: b.indent * 26 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {editable && (
        <div className="block-handle">
          <IconButton title="Insert block below" onClick={onAdd}>
            <Plus size={16} />
          </IconButton>
          <button
            draggable
            onDragStart={onDragStart}
            aria-label="Block actions"
            onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}
          >
            <GripVertical size={16} />
          </button>
        </div>
      )}
      {b.type === 'todo' && (
        <input
          aria-label="Complete task"
          type="checkbox"
          checked={checked}
          disabled={!editable}
          onChange={async (e) => {
            const value = e.target.checked;
            setChecked(value);
            try {
              if (!(await save())) {
                setChecked(!value);
                return;
              }
              const next = await api(`/pages/${pageId}/blocks/${b.id}`, 'PATCH', {
                checked: value,
                revision: revision.current,
              });
              revision.current = next.revision;
              await refresh();
            } catch (e) {
              error(e.message);
            }
          }}
        />
      )}
      {b.type === 'bullet' && <span className="bullet">•</span>}
      {b.type === 'number' && <span className="bullet">{number}.</span>}
      {b.type === 'callout' && <Lightbulb className="callout-icon" size={22} />}
      {b.type === 'toggle' && (
        <IconButton title={expanded ? 'Collapse toggle' : 'Expand toggle'} onClick={onToggle}>
          <ChevronRight size={17} style={{ transform: expanded ? 'rotate(90deg)' : '' }} />
        </IconButton>
      )}
      {b.type === 'divider' ? (
        <hr />
      ) : b.type === 'image' ? (
        <div className="image-block">
          {safe ? <img src={url} alt="Embedded image" /> : <span>Invalid image URL</span>}
          {editable && <small>Change the URL using Block actions → Image</small>}
        </div>
      ) : b.type === 'bookmark' ? (
        <a className="bookmark" href={safe ? url : undefined} target="_blank" rel="noreferrer">
          <Link size={20} />
          <span>{url}</span>
          <ChevronRight size={16} />
        </a>
      ) : (
        <div
          ref={ref}
          role="textbox"
          aria-label={`${b.type} block`}
          className="block-content"
          contentEditable={editable}
          suppressContentEditableWarning
          data-placeholder={b.type === 'text' ? "Type '/' for commands" : 'Write something…'}
          onInput={changed}
          onBlur={() => {
            if (!slashOpen) save();
          }}
          onKeyDown={keys}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
        />
      )}
      {conflict && (
        <div className="conflict-actions" role="alert">
          <span>This block changed elsewhere. Your text is kept here.</span>
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(ref.current?.textContent || '')
                .then(() => error('Your text was copied'))
                .catch((e) => error(e.message))
            }
          >
            Copy my text
          </button>
          <button
            onClick={async () => {
              try {
                const current = await api(`/pages/${pageId}`);
                const next = current.blocks.find((block) => block.id === b.id);
                if (next) window.dispatchEvent(new CustomEvent('block-replaced', { detail: next }));
                await refresh();
              } catch (e) {
                error(e.message);
              }
            }}
          >
            Use saved version
          </button>
        </div>
      )}
    </div>
  );
}
