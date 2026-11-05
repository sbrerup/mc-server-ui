import { Info, Lock, Link2, RotateCcw, Undo2, X } from "lucide-react";
import { memo, useId, useMemo, useState, type KeyboardEvent } from "react";
import { technicalKey } from "../../../shared/catalog";
import { valuesEqual } from "../../../shared/rules";
import type { Control, Issue, Setting, Value, ValueSource } from "../../../shared/types";
import { displayValue, effectDetail, effectLabel } from "../format";
import { Tooltip } from "./Tooltip";

/** IANA time zones, for suggestions on the time zone setting. */
const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/Copenhagen", "Europe/London", "America/New_York"];
  }
})();

function SettingTooltip({ setting, source }: { setting: Setting; source?: ValueSource }) {
  return (
    <div className="tooltip-body">
      <p className="tooltip-help">{setting.help}</p>
      {setting.hint && <p className="tooltip-hint">{setting.hint}</p>}
      {setting.locked && (
        <p className="tooltip-note">
          <Lock size={13} aria-hidden /> {setting.locked}
        </p>
      )}
      {setting.derived && (
        <p className="tooltip-note">
          <Link2 size={13} aria-hidden /> {setting.derived}
        </p>
      )}
      {setting.danger && !setting.locked && <p className="tooltip-danger">{setting.danger}</p>}
      {setting.control.type === "select" && setting.control.options.some((o) => o.help) && (
        <dl className="tooltip-options">
          {setting.control.options.map((option) => (
            <div key={String(option.value)}>
              <dt>{option.label}</dt>
              <dd>{option.help}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl className="tooltip-facts">
        {setting.default !== undefined && (
          <div>
            <dt>Default</dt>
            <dd>{displayValue(setting, setting.default)}</dd>
          </div>
        )}
        <div>
          <dt>When</dt>
          <dd>{effectDetail(setting.effect)}</dd>
        </div>
        {source && (
          <div>
            <dt>Stored</dt>
            <dd>
              {source === "git" && setting.target.kind !== "gamerule" && "Set in Git."}
              {source === "live" && setting.target.kind === "gamerule" && "In the world, on the server."}
              {source === "live" && setting.target.kind !== "gamerule" && "Not set in Git. This is the running server's value."}
              {source === "default" && "Not set in Git, and the server couldn't be read. This is the documented default."}
            </dd>
          </div>
        )}
        <div>
          <dt>Key</dt>
          <dd>
            <code>{technicalKey(setting)}</code>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function NumberControl({ control, value, disabled, onChange, labelId }: ControlProps<Extract<Control, { type: "number" }>>) {
  const isSpecial = control.specials?.some((s) => s.value === value);
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? (typeof value === "number" && !isSpecial ? String(value) : "");

  return (
    <div className="number-control">
      <div className="input-with-unit">
        <input
          type="number"
          inputMode="decimal"
          aria-labelledby={labelId}
          disabled={disabled}
          min={control.min}
          max={control.max}
          step={control.step ?? "any"}
          value={shown}
          placeholder={isSpecial ? "" : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value !== "") {
              const parsed = Number(e.target.value);
              if (!Number.isNaN(parsed)) onChange(parsed);
            }
          }}
          onBlur={() => setDraft(undefined)}
        />
        {control.unit && <span className="unit">{control.unit}</span>}
      </div>
      {control.specials && (
        <div className="specials" role="group" aria-label="Preset values">
          {control.specials.map((special) => (
            <button
              key={String(special.value)}
              type="button"
              disabled={disabled}
              className={`chip${value === special.value ? " chip-on" : ""}`}
              aria-pressed={value === special.value}
              onClick={() => {
                setDraft(undefined);
                onChange(special.value);
              }}
            >
              {special.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListControl({ control, value, disabled, onChange, labelId }: ControlProps<Extract<Control, { type: "list" }>>) {
  const items = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState("");

  if (control.choices) {
    return (
      <div className="specials" role="group" aria-labelledby={labelId}>
        {control.choices.map((choice) => {
          const on = items.includes(choice);
          return (
            <button
              key={choice}
              type="button"
              disabled={disabled}
              className={`chip${on ? " chip-on" : ""}`}
              aria-pressed={on}
              onClick={() => onChange(on ? items.filter((i) => i !== choice) : control.choices!.filter((c) => c === choice || items.includes(c)))}
            >
              {choice}
            </button>
          );
        })}
      </div>
    );
  }

  const add = () => {
    const next = draft.trim();
    if (next && !items.includes(next)) onChange([...items, next]);
    setDraft("");
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || (event.key === "," && control.separator !== "\n")) {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && items.length) {
      onChange(items.slice(0, -1));
    }
  };

  return (
    <div className="list-control">
      {items.length > 0 && (
        <ul className="list-items">
          {items.map((item) => (
            <li key={item}>
              <span>{item}</span>
              {!disabled && (
                <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="list-add">
          <input
            aria-labelledby={labelId}
            value={draft}
            placeholder={control.placeholder ?? "Add…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
          />
        </div>
      )}
    </div>
  );
}

interface ControlProps<C extends Control = Control> {
  control: C;
  value: Value | undefined;
  disabled: boolean;
  onChange: (value: Value) => void;
  labelId: string;
}

function ControlInput({ control, value, disabled, onChange, labelId }: ControlProps) {
  const listId = useId();
  switch (control.type) {
    case "toggle":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          aria-labelledby={labelId}
          disabled={disabled}
          className={`switch${value === true ? " switch-on" : ""}`}
          onClick={() => onChange(value !== true)}
        >
          <span className="switch-knob" />
        </button>
      );
    case "number":
      return <NumberControl control={control} value={value} disabled={disabled} onChange={onChange} labelId={labelId} />;
    case "text":
      return (
        <>
          <input
            type="text"
            className={control.mono ? "mono" : undefined}
            aria-labelledby={labelId}
            disabled={disabled}
            spellCheck={false}
            list={control.suggestions ? listId : undefined}
            value={typeof value === "string" ? value : String(value ?? "")}
            placeholder={control.placeholder}
            maxLength={control.maxLength}
            onChange={(e) => onChange(e.target.value)}
          />
          {control.suggestions && (
            <datalist id={listId}>
              {(control.suggestions === "timezones" ? TIME_ZONES : control.suggestions).map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          )}
        </>
      );
    case "textarea":
      return (
        <textarea
          className={control.mono ? "mono" : undefined}
          aria-labelledby={labelId}
          disabled={disabled}
          rows={control.rows ?? 3}
          spellCheck={false}
          value={typeof value === "string" ? value : ""}
          placeholder={control.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <select
          aria-labelledby={labelId}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => {
            const option = control.options.find((o) => String(o.value) === e.target.value);
            if (option) onChange(option.value);
          }}
        >
          {!control.options.some((o) => o.value === value) && <option value={String(value ?? "")}>{String(value ?? "")}</option>}
          {control.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "list":
      return <ListControl control={control} value={value} disabled={disabled} onChange={onChange} labelId={labelId} />;
  }
}

interface SettingRowProps {
  setting: Setting;
  value: Value | undefined;
  original: Value | undefined;
  source?: ValueSource;
  issues: Issue[];
  /** Set when another setting's edit changed this one. */
  followingFrom?: string;
  edited: boolean;
  disabled?: boolean;
  onEdit: (id: string, value: Value) => void;
  onRevert: (id: string) => void;
}

/** One line of the settings form. Memoised, as a page can show well over a hundred. */
export const SettingRow = memo(function SettingRow({ setting, value, original, source, issues, followingFrom, edited, disabled, onEdit, onRevert }: SettingRowProps) {
  const labelId = useId();
  const changed = !valuesEqual(value, original);
  const readOnly = !!setting.locked || !!setting.derived || !!disabled;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const canResetToDefault = !readOnly && setting.default !== undefined && !valuesEqual(value, setting.default);

  const change = useMemo(() => (next: Value) => onEdit(setting.id, next), [onEdit, setting.id]);

  return (
    <div className={`setting${changed ? " setting-changed" : ""}${errors.length ? " setting-error" : ""}`} data-setting={setting.id}>
      <div className="setting-label">
        <div className="setting-title">
          <span id={labelId}>{setting.label}</span>
          <Tooltip label={`About ${setting.label}`} content={<SettingTooltip setting={setting} source={source} />}>
            <Info size={15} aria-hidden />
          </Tooltip>
          {setting.locked && (
            <span className="badge badge-muted">
              <Lock size={11} aria-hidden /> Locked
            </span>
          )}
          {setting.derived && (
            <span className="badge badge-muted">
              <Link2 size={11} aria-hidden /> Automatic
            </span>
          )}
          {setting.effect === "live" && <span className="badge badge-live">Instant</span>}
          {setting.effect === "new-world" && <span className="badge badge-world">New terrain</span>}
        </div>
        {changed && (
          <div className="setting-was">
            {followingFrom ? `Follows ${followingFrom}. ` : ""}Was {displayValue(setting, original)}
          </div>
        )}
        {errors.map((issue) => (
          <div key={issue.message} className="setting-issue setting-issue-error" role="alert">
            {issue.message}
          </div>
        ))}
        {warnings.map((issue) => (
          <div key={issue.message} className="setting-issue setting-issue-warning">
            {issue.message}
          </div>
        ))}
      </div>
      <div className="setting-control">
        <ControlInput control={setting.control} value={value} disabled={readOnly} onChange={change} labelId={labelId} />
        <div className="setting-actions">
          {edited ? (
            <button type="button" className="icon-button" aria-label={`Undo change to ${setting.label}`} title="Undo this change" onClick={() => onRevert(setting.id)}>
              <Undo2 size={15} />
            </button>
          ) : (
            canResetToDefault && (
              <button
                type="button"
                className="icon-button icon-button-quiet"
                aria-label={`Reset ${setting.label} to default`}
                title={`Reset to default (${displayValue(setting, setting.default)})`}
                onClick={() => onEdit(setting.id, setting.default!)}
              >
                <RotateCcw size={14} />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
});

export { effectLabel };
