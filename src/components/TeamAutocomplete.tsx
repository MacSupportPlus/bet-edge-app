"use client";

import { useState } from "react";

const MAX_SUGGESTIONS = 8;

/**
 * A real filtered dropdown ("word wheel") instead of the browser's native
 * <datalist> — that renders wildly differently (or barely at all) across
 * browsers and doesn't filter well on some platforms. Fully controlled:
 * `value` is whatever the user's typed so far, `onChange` fires on every
 * keystroke AND on picking a suggestion.
 */
export function TeamAutocomplete({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const query = value.trim().toLowerCase();
  const matches = (query ? options.filter((o) => o.toLowerCase().includes(query)) : options).slice(0, MAX_SUGGESTIONS);

  function select(option: string) {
    onChange(option);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && matches[highlighted]) {
            e.preventDefault();
            select(matches[highlighted]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-md border px-2 py-1.5"
        style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
      />
      {open && matches.length > 0 && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border text-sm shadow-lg"
          style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
        >
          {matches.map((m, i) => (
            <li
              key={m}
              // onMouseDown (not onClick) fires before the input's onBlur, so
              // picking a suggestion doesn't get raced/cancelled by the blur close.
              onMouseDown={(e) => {
                e.preventDefault();
                select(m);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className="cursor-pointer px-2 py-1.5"
              style={{
                background: i === highlighted ? "var(--series-1)" : "transparent",
                color: i === highlighted ? "white" : "var(--text-primary)",
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
