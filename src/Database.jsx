import React, { useState, useRef } from 'react';
import {
  Table2,
  Columns3,
  List,
  LayoutGrid,
  CalendarDays,
  Plus,
  ArrowDownWideNarrow,
  Filter,
  Search,
  SlidersHorizontal,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { api, canEdit, label, uid } from './api';
import { IconButton, Modal, Field, PageIcon, Empty } from './ui';
const viewIcons = {
  table: Table2,
  board: Columns3,
  list: List,
  gallery: LayoutGrid,
  calendar: CalendarDays,
};
export default function Database({
  page,
  pages,
  navigate,
  createPage,
  patchPage,
  reload,
  error,
  prompt,
}) {
  const rowSaves = useRef(new Map());
  const config = page.config,
    properties = config.properties || [],
    views = config.views || [],
    [active, setActive] = useState(views[0]?.id),
    [search, setSearch] = useState(''),
    [showSearch, setShowSearch] = useState(false),
    [modal, setModal] = useState(null),
    [month, setMonth] = useState(new Date());
  const view = views.find((v) => v.id === active) || views[0],
    editable = canEdit(page),
    selectProp = properties.find((p) => p.type === 'select'),
    dateProp = properties.find((p) => p.type === 'date');
  let rows = pages
    .filter((p) => p.parent_id === page.id)
    .filter((p) => label(p).toLowerCase().includes(search.toLowerCase()));
  if (view?.filter && selectProp)
    rows = rows.filter((p) => p.properties[selectProp.id] === view.filter);
  if (view?.sort === 'asc') rows.sort((a, b) => label(a).localeCompare(label(b)));
  if (view?.sort === 'desc') rows.sort((a, b) => label(b).localeCompare(label(a)));
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      error(e.message);
    }
  };
  const saveConfig = async (c) => patchPage({ config: c });
  const updateView = async (changes) =>
    saveConfig({
      ...config,
      views: views.map((v) => (v.id === view.id ? { ...v, ...changes } : v)),
    });
  const setValue = (row, prop, value) => {
    const previous = rowSaves.current.get(row.id) || Promise.resolve(row);
    const task = previous
      .catch(() => row)
      .then(async (saved) => {
        const current = saved.revision > row.revision ? saved : row;
        const result = await api(`/pages/${row.id}`, 'PATCH', {
          revision: current.revision,
          properties: { ...current.properties, [prop.id]: value },
        });
        await reload();
        return result;
      });
    rowSaves.current.set(row.id, task);
    return task;
  };
  const add = async (values = {}) => {
    const id = await createPage('page', page.id, false);
    if (id && Object.keys(values).length) {
      const row = await api(`/pages/${id}`);
      await api(`/pages/${id}`, 'PATCH', { revision: row.revision, properties: values });
      await reload();
    }
    return id;
  };
  const cell = (row, prop) => (
    <Property
      key={prop.id}
      row={row}
      prop={prop}
      editable={editable && canEdit(row)}
      onChange={(value) => run(() => setValue(row, prop, value))}
    />
  );
  const name = (row) => (
    <button className="row-name" onClick={() => navigate(row.id)}>
      <PageIcon page={row} />
      <span>{label(row)}</span>
      <ExternalLink size={12} />
    </button>
  );
  const card = (row) => (
    <div className="database-card" key={row.id}>
      {name(row)}
      {properties.map((p) => (
        <div key={p.id} className="card-property">
          <span>{p.name}</span>
          {cell(row, p)}
        </div>
      ))}
    </div>
  );
  return (
    <div className="database">
      <div className="database-toolbar">
        <div className="view-tabs">
          {views.map((v) => {
            const Icon = viewIcons[v.type];
            return (
              <button
                key={v.id}
                className={v.id === view.id ? 'active' : ''}
                onClick={() => setActive(v.id)}
              >
                <Icon size={16} />
                {v.name}
              </button>
            );
          })}
          {editable && (
            <IconButton title="Add a view" onClick={() => setModal('view')}>
              <Plus size={17} />
            </IconButton>
          )}
        </div>
        <div className="row tools">
          <IconButton title="Filter database" onClick={() => setModal('filter')}>
            <Filter size={16} className={view.filter ? 'blue' : ''} />
          </IconButton>
          <IconButton title="Sort database" onClick={() => setModal('sort')}>
            <ArrowDownWideNarrow size={16} />
          </IconButton>
          <IconButton title="Search database" onClick={() => setShowSearch(!showSearch)}>
            <Search size={16} />
          </IconButton>
          {editable && (
            <>
              <IconButton title="Database settings" onClick={() => setModal('settings')}>
                <SlidersHorizontal size={16} />
              </IconButton>
              <button
                className="primary compact"
                onClick={() => run(async () => navigate(await add()))}
              >
                New <Plus size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {showSearch && (
        <input
          className="database-search"
          aria-label="Search database"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {view.filter && (
        <button className="filter-pill" onClick={() => setModal('filter')}>
          <Filter size={13} />
          {selectProp?.name}: {view.filter}
        </button>
      )}
      {view.type === 'table' && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="name-cell">
                  <span className="muted">Aa</span> Name
                </th>
                {properties.map((p) => (
                  <th key={p.id}>
                    {
                      { text: 'Aa', number: '#', select: '◉', date: '◷', checkbox: '☑', url: '↗' }[
                        p.type
                      ]
                    }{' '}
                    {p.name}
                  </th>
                ))}
                {editable && (
                  <th>
                    <button onClick={() => setModal('property')}>
                      <Plus size={14} /> Add property
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{name(row)}</td>
                  {properties.map((p) => (
                    <td key={p.id}>{cell(row, p)}</td>
                  ))}
                  {editable && <td />}
                </tr>
              ))}
            </tbody>
          </table>
          {editable && (
            <button className="new-row" onClick={() => run(() => add())}>
              <Plus size={16} /> New page
            </button>
          )}
          <div className="database-count">
            {rows.length} {rows.length === 1 ? 'page' : 'pages'}
          </div>
        </div>
      )}
      {view.type === 'board' && (
        <div className="board">
          {(selectProp ? ['', ...selectProp.options] : ['']).map((option, i) => (
            <section
              className="board-column"
              key={option}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const row = rows.find((r) => r.id === e.dataTransfer.getData('text/plain'));
                if (row && selectProp && editable) run(() => setValue(row, selectProp, option));
              }}
            >
              <header>
                <span className={'tag tag-' + i}>
                  {option || 'No ' + (selectProp?.name || 'status')}
                </span>
                <span className="muted">
                  {rows.filter((r) => (r.properties[selectProp?.id] || '') === option).length}
                </span>
                {editable && (
                  <IconButton
                    title={'Add to ' + (option || 'No status')}
                    onClick={() => run(() => add(selectProp ? { [selectProp.id]: option } : {}))}
                  >
                    <Plus size={15} />
                  </IconButton>
                )}
              </header>
              {rows
                .filter((r) => (r.properties[selectProp?.id] || '') === option)
                .map((row) => (
                  <div
                    key={row.id}
                    draggable={editable}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', row.id)}
                  >
                    {card(row)}
                  </div>
                ))}
              {editable && (
                <button
                  className="new-row"
                  onClick={() => run(() => add(selectProp ? { [selectProp.id]: option } : {}))}
                >
                  <Plus size={15} /> New
                </button>
              )}
            </section>
          ))}
        </div>
      )}
      {view.type === 'gallery' && (
        <div className="gallery">
          {rows.map((row) => (
            <div className="gallery-card" key={row.id}>
              <button
                className="gallery-cover"
                style={{ background: row.cover || '#f7f7f5' }}
                onClick={() => navigate(row.id)}
              >
                {row.icon || '📄'}
              </button>
              {card(row)}
            </div>
          ))}
        </div>
      )}
      {view.type === 'list' && (
        <div className="database-list">
          {rows.map((row) => (
            <div key={row.id}>
              {name(row)}
              <div className="row">{properties.slice(0, 3).map((p) => cell(row, p))}</div>
            </div>
          ))}
        </div>
      )}
      {view.type === 'calendar' && (
        <>
          <div className="calendar-toolbar">
            <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
            <div className="row">
              <button onClick={() => setMonth(new Date())}>Today</button>
              <IconButton
                title="Previous month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft size={17} />
              </IconButton>
              <IconButton
                title="Next month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight size={17} />
              </IconButton>
            </div>
          </div>
          {dateProp ? (
            <div className="calendar">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div className="day-label" key={d}>
                  {d}
                </div>
              ))}
              {Array.from({ length: 42 }, (_, i) => {
                const d = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    1 - new Date(month.getFullYear(), month.getMonth(), 1).getDay() + i,
                  ),
                  date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                return (
                  <div
                    className={
                      'calendar-day ' + (d.getMonth() !== month.getMonth() ? 'outside' : '')
                    }
                    key={i}
                  >
                    <span>{d.getDate()}</span>
                    {editable && (
                      <IconButton
                        title={'Add page on ' + date}
                        onClick={() => run(() => add({ [dateProp.id]: date }))}
                      >
                        <Plus size={12} />
                      </IconButton>
                    )}
                    {rows
                      .filter((r) => r.properties[dateProp.id] === date)
                      .map((r) => (
                        <div key={r.id}>{name(r)}</div>
                      ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="Add a date property">
              Calendar uses the first date property in this database.
            </Empty>
          )}
          <p className="muted small">
            {rows.filter((r) => !r.properties[dateProp?.id]).length} pages without a date
          </p>
        </>
      )}
      {editable && ['list', 'gallery'].includes(view.type) && (
        <button className="new-row" onClick={() => run(() => add())}>
          <Plus size={16} /> New page
        </button>
      )}
      {modal === 'view' && (
        <ViewModal
          onClose={() => setModal(null)}
          onSave={async (name, type) => {
            const id = uid();
            await run(async () => {
              await saveConfig({
                ...config,
                views: [...views, { id, name, type, filter: '', sort: 'manual' }],
              });
              setActive(id);
              setModal(null);
            });
          }}
        />
      )}
      {modal === 'property' && (
        <PropertyModal
          onClose={() => setModal(null)}
          onSave={async (prop) =>
            run(async () => {
              await saveConfig({ ...config, properties: [...properties, { id: uid(), ...prop }] });
              setModal(null);
            })
          }
        />
      )}
      {['filter', 'sort', 'settings'].includes(modal) && (
        <Modal
          title={modal === 'filter' ? 'Filter' : modal === 'sort' ? 'Sort' : 'Database settings'}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            {modal === 'filter' &&
              (selectProp ? (
                <Field label={selectProp.name}>
                  <select
                    value={view.filter || ''}
                    disabled={!editable}
                    onChange={(e) => run(() => updateView({ filter: e.target.value }))}
                  >
                    <option value="">All pages</option>
                    {selectProp.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p>Add a select property to filter this database.</p>
              ))}
            {modal === 'sort' && (
              <Field label="Sort by name">
                <select
                  value={view.sort || 'manual'}
                  disabled={!editable}
                  onChange={(e) => run(() => updateView({ sort: e.target.value }))}
                >
                  <option value="manual">Created order</option>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </Field>
            )}
            {modal === 'settings' && (
              <>
                <Field label="View name">
                  <input
                    defaultValue={view.name}
                    onBlur={(e) => run(() => updateView({ name: e.target.value || view.name }))}
                  />
                </Field>
                {views.length > 1 && (
                  <button
                    className="danger"
                    onClick={() =>
                      run(async () => {
                        await saveConfig({
                          ...config,
                          views: views.filter((v) => v.id !== view.id),
                        });
                        setModal(null);
                      })
                    }
                  >
                    <Trash2 size={15} /> Delete this view
                  </button>
                )}
                <h4>Properties</h4>
                {properties.map((p) => (
                  <div className="settings-property" key={p.id}>
                    <span>
                      {p.name} <small className="muted">{p.type}</small>
                    </span>
                    <IconButton
                      title={'Delete ' + p.name + ' property'}
                      onClick={() =>
                        run(() =>
                          saveConfig({
                            ...config,
                            properties: properties.filter((x) => x.id !== p.id),
                          }),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
                <button onClick={() => setModal('property')}>
                  <Plus size={15} />
                  Add a property
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Property({ row, prop, editable, onChange }) {
  const value = row.properties[prop.id] ?? '';
  if (prop.type === 'checkbox')
    return (
      <input
        aria-label={prop.name}
        type="checkbox"
        checked={!!value}
        disabled={!editable}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (prop.type === 'select')
    return (
      <select
        aria-label={prop.name}
        className={'property-select tag tag-' + ((prop.options.indexOf(value) + 1) % 4)}
        value={value}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Empty</option>
        {prop.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={prop.name}
      key={row.id + prop.id + value}
      className="property-input"
      type={
        prop.type === 'date'
          ? 'date'
          : prop.type === 'number'
            ? 'number'
            : prop.type === 'url'
              ? 'url'
              : 'text'
      }
      placeholder="Empty"
      defaultValue={value}
      disabled={!editable}
      onBlur={(e) => {
        if (e.target.value !== String(value)) onChange(e.target.value);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  );
}
function ViewModal({ onClose, onSave }) {
  const [name, setName] = useState('Board'),
    [type, setType] = useState('board');
  return (
    <Modal title="New view" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name, type);
        }}
      >
        <div className="modal-body">
          <Field label="View name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="view-choices">
            {Object.entries(viewIcons).map(([key, Icon]) => (
              <button
                type="button"
                className={type === key ? 'selected' : ''}
                key={key}
                onClick={() => {
                  setType(key);
                  setName(key[0].toUpperCase() + key.slice(1));
                }}
              >
                <Icon size={24} />
                {key}
              </button>
            ))}
          </div>
        </div>
        <footer>
          <button className="primary">Create view</button>
        </footer>
      </form>
    </Modal>
  );
}
function PropertyModal({ onClose, onSave }) {
  const [name, setName] = useState(''),
    [type, setType] = useState('text'),
    [options, setOptions] = useState('Not started, In progress, Done');
  return (
    <Modal title="New property" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name,
            type,
            ...(type === 'select'
              ? {
                  options: [
                    ...new Set(
                      options
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                }
              : {}),
          });
        }}
      >
        <div className="modal-body">
          <Field label="Property name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {['text', 'number', 'select', 'date', 'checkbox', 'url'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          {type === 'select' && (
            <Field label="Options, separated by commas">
              <input value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          )}
        </div>
        <footer>
          <button className="primary">Add property</button>
        </footer>
      </form>
    </Modal>
  );
}
