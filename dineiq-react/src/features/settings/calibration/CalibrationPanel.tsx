import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ApiError, authRequest, jsonRequest } from "@/lib/auth";
import { changeDraft, parseDraft, toDraft, type Configuration, type Draft } from "./model";
import "./calibration.css";

const base = "/admin/settings/calibration";
const sliders = [
  { key: "person_confidence", label: "People detection", help: "Higher catches more people. Lower reduces false detections.", sensitivity: true },
  { key: "object_confidence", label: "Cleaning detection", help: "Higher spots more leftover objects. Lower reduces false cleaning alerts.", sensitivity: true },
  { key: "occupancy_increase_seconds", label: "Confirm arrivals", help: "How long someone must stay before being counted as seated.", sensitivity: false },
  { key: "occupancy_decrease_seconds", label: "Confirm departures", help: "How long a seat must stay empty before someone is counted as having left.", sensitivity: false },
];

export function CalibrationPanel() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void authRequest<Configuration>(base, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setConfiguration(value);
      setDraft(toDraft(value.settings, value.controls));
      setError("");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [reload]);

  const parsed = useMemo(() => configuration ? parseDraft(draft, configuration.controls) : {}, [draft, configuration]);
  const dirty = Boolean(configuration && JSON.stringify(draft) !== JSON.stringify(toDraft(configuration.settings, configuration.controls)));

  async function reloadSettings() {
    setBusy(true);
    try {
      const value = await authRequest<Configuration>(base);
      const saved = toDraft(value.settings, value.controls);
      // Preserve edited sliders while refreshing the saved baseline and hidden settings.
      const previous = configuration ? toDraft(configuration.settings, configuration.controls) : {};
      for (const { key } of sliders) {
        if (draft[key] !== undefined && draft[key] !== previous[key]) saved[key] = draft[key];
      }
      setConfiguration(value);
      setDraft(saved);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reload settings.");
    } finally { setBusy(false); }
  }

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (!configuration || !parsed.settings) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const value = await authRequest<Configuration>(base, jsonRequest("PUT", {
        settings: { ...configuration.settings, ...Object.fromEntries(sliders.map(({ key }) => [key, parsed.settings![key]])) },
        expected_revision: configuration.revision,
      }));
      setConfiguration(value); setDraft(toDraft(value.settings, value.controls));
      setMessage("Settings saved. Monitoring will use these adjustments.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError("Another admin changed these settings. Reload settings to keep your slider changes and try saving again.");
      } else setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally { setBusy(false); }
  }

  return <section className="settings-section calibration-panel" aria-labelledby="calibration-title">
    <h2 id="calibration-title">Calibration</h2>
    <p>Adjust detection and how quickly seat counts change. Save when you’re ready.</p>
    {error && <div role="alert"><p className="account-error">{error}</p><Button variant="outline" disabled={busy} onClick={() => configuration ? void reloadSettings() : setReload(value => value + 1)}>Reload settings</Button></div>}
    {!configuration ? !error && <p role="status">Loading calibration…</p> : <>
      <form onSubmit={apply}>
        <fieldset disabled={busy} className="calibration-fields" aria-label="Detection adjustments">
          <div className="calibration-inputs">{sliders.map(({ key, label, help, sensitivity }) => {
            const control = configuration.controls[key];
            if (!control) return null;
            const value = sensitivity ? Number((100 - Number(draft[key])).toFixed(6)) : Number(draft[key]);
            const valueLabel = `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${sensitivity ? "%" : " seconds"}`;
            return <label key={key} htmlFor={`calibration-${key}`}>
              <span className="calibration-slider-heading">
                <span>{label}</span>
                <output id={`calibration-value-${key}`} htmlFor={`calibration-${key}`}>{valueLabel}</output>
              </span>
              <input id={`calibration-${key}`} className="calibration-slider" type="range" value={value}
                min={sensitivity ? Number((100 - control.maximum * 100).toFixed(6)) : control.minimum}
                max={sensitivity ? Number((100 - control.minimum * 100).toFixed(6)) : control.maximum} step="any"
                aria-valuetext={valueLabel} aria-describedby={`calibration-help-${key}`}
                onChange={event => {
                  const next = sensitivity ? String(Number((100 - Number(event.target.value)).toFixed(6))) : event.target.value;
                  setDraft(changeDraft(draft, key, next)); setMessage("");
                }} />
              <small id={`calibration-help-${key}`}>{help}</small>
            </label>;
          })}</div>
          {parsed.error && <p role="alert" className="account-error">{parsed.error}</p>}
          {dirty && <p className="calibration-unsaved">Unsaved changes</p>}
          <div className="calibration-actions">
            <Button type="submit" disabled={!dirty || !parsed.settings}>{busy ? "Saving…" : "Save settings"}</Button>
            <Button type="button" variant="outline" disabled={!dirty} onClick={() => { setDraft(toDraft(configuration.settings, configuration.controls)); setMessage(""); }}>Undo changes</Button>
            <Button type="button" variant="outline" onClick={() => {
              const defaults = toDraft(configuration.defaults, configuration.controls);
              setDraft(previous => ({ ...previous, ...Object.fromEntries(sliders.filter(({ key }) => key in defaults).map(({ key }) => [key, defaults[key]])) }));
              setMessage("Sliders reset. Save settings to use these values.");
            }}>Reset sliders</Button>
          </div>
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      <p><Link to="/tables">Adjust table and seat boundaries</Link></p>
    </>}
  </section>;
}
