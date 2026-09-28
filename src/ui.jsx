import React, { useState, useEffect, useRef } from 'react';
import { X, FileText, ChevronRight } from 'lucide-react';
export function IconButton({ title, children, ...props }) {
  return (
    <button type="button" className="icon-button" aria-label={title} title={title} {...props}>
      {children}
    </button>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = [
          ...ref.current.querySelectorAll('button,input,select,textarea,a[href]'),
        ].filter((x) => !x.disabled);
        if (!items.length) return;
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    ref.current.querySelector('[autofocus],input,button')?.focus();
    return () => {
      document.removeEventListener('keydown', handler);
      prev?.focus();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
export function PageIcon({ page }) {
  return page?.icon ? (
    <span className="page-emoji">{page.icon}</span>
  ) : (
    <FileText size={16} className="muted" />
  );
}
export function Field({ label, children }) {
  const attach = (node) =>
    React.isValidElement(node)
      ? React.cloneElement(
          node,
          ['input', 'select', 'textarea'].includes(node.type)
            ? { 'aria-label': node.props['aria-label'] || label }
            : {},
          node.props.children ? React.Children.map(node.props.children, attach) : undefined,
        )
      : node;
  return (
    <label className="field">
      <span>{label}</span>
      {React.Children.map(children, attach)}
    </label>
  );
}
export function Empty({ icon: Icon = FileText, title, children }) {
  return (
    <div className="empty">
      <Icon size={32} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Prompt({ spec, onClose }) {
  const [value, setValue] = useState(spec.value || '');
  return (
    <Modal title={spec.title} onClose={() => onClose(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose(value);
        }}
      >
        <div className="modal-body">
          <Field label={spec.label || spec.title}>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={spec.placeholder || ''}
              required={!spec.optional}
            />
          </Field>
          {spec.description && <p className="muted small">{spec.description}</p>}
        </div>
        <footer>
          <button type="button" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button className="primary">{spec.action || 'Save'}</button>
        </footer>
      </form>
    </Modal>
  );
}
