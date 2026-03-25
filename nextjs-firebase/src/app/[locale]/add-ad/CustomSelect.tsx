"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./CustomSelect.module.css";

export type CustomSelectOption = { value: string; label: string };

export type CustomSelectField = "city" | "department" | "category";

type Props = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: CustomSelectOption[];
  /** Shown when `value` is empty and as first list row (value ""). */
  placeholder: string;
  disabled?: boolean;
  /** Drives accent colour and leading icon (شهر / بخش / دسته). */
  field?: CustomSelectField;
};

function IconCity({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21c-3.2-2.6-6-5.4-6-9a6 6 0 0 1 12 0c0 3.6-2.8 6.4-6 9Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function IconDepartment({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="4"
        y="4"
        width="16"
        height="6"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="4"
        y="12"
        width="16"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
        opacity={0.88}
      />
    </svg>
  );
}

function IconCategory({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 5.75h8.5l9.5 9.5v5a1.25 1.25 0 0 1-1.25 1.25H4.25A1.25 1.25 0 0 1 3 20.25V6.75a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="9.75" r="1.35" fill="currentColor" />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FieldGlyph({ field, className }: { field?: CustomSelectField; className?: string }) {
  switch (field) {
    case "department":
      return <IconDepartment className={className} />;
    case "category":
      return <IconCategory className={className} />;
    default:
      return <IconCity className={className} />;
  }
}

export function CustomSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  field = "city",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const rows: CustomSelectOption[] = [
    { value: "", label: placeholder },
    ...options.filter((o) => o.value !== ""),
  ];

  const selected = options.find((o) => o.value === value);
  const display = value && selected ? selected.label : placeholder;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef} data-field={field}>
      <button
        type="button"
        id={id}
        className={`${styles.trigger} ${disabled ? styles.triggerDisabled : ""} ${open ? styles.triggerOpen : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className={styles.iconWrap} aria-hidden>
          <FieldGlyph field={field} className={styles.icon} />
        </span>
        <span className={styles.triggerMain}>
          <span
            className={`${styles.triggerText} ${!value ? styles.triggerPlaceholder : ""}`}
          >
            {display}
          </span>
          <span className={styles.chevronWrap} aria-hidden>
            <IconChevron className={styles.chevron} />
          </span>
        </span>
      </button>
      {open && !disabled ? (
        <div className={styles.dropdown} id={listId} role="listbox">
          <ul className={styles.list}>
            {rows.map((o) => {
              const isPlace = o.value === "";
              const isSelected = o.value === value;
              return (
                <li key={o.value === "" ? "__ph" : o.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ""} ${isPlace ? styles.optionPlaceholder : ""}`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.optionLabel}>{o.label}</span>
                    {!isPlace ? (
                      <span className={styles.optionCheck} aria-hidden>
                        {isSelected ? "✓" : ""}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
