"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContactDraft, ContactRecord, FeatureStatus, SaveContactResult, SalesforcePushResult } from "./lib/types";

type Tab = "upload" | "dashboard" | "salesforce" | "exports";

const emptyFeatures: FeatureStatus = {
  database: false,
  googleVision: false,
  llmExtraction: false,
  ocr: false,
  salesforce: false,
  linkedinEnrichment: false,
  auth: false
};

function confidenceClass(value: number): string {
  if (value >= 80) return "confHigh";
  if (value >= 60) return "confMid";
  return "confLow";
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function textToTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("upload");
  const [eventName, setEventName] = useState("GB AI Innovation Day");
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<ContactDraft[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [features, setFeatures] = useState<FeatureStatus>(emptyFeatures);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function loadContacts() {
    const response = await fetch("/api/contacts", { cache: "no-store" });
    const data = await response.json();
    setContacts(data.contacts || []);
    setFeatures(data.features || emptyFeatures);
    if (!response.ok && data.error) setError(data.error);
  }

  useEffect(() => {
    void loadContacts();
  }, []);

  const filteredContacts = useMemo(() => {
    return contacts.filter((contact) => {
      const statusOk = statusFilter === "all" || contact.status === statusFilter;
      const tagOk = !tagFilter || contact.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()));
      return statusOk && tagOk;
    });
  }, [contacts, statusFilter, tagFilter]);

  const metrics = useMemo(() => {
    const avg = contacts.length
      ? Math.round(contacts.reduce((sum, contact) => sum + contact.confidence, 0) / contacts.length)
      : 0;
    return {
      contacts: contacts.length,
      events: new Set(contacts.map((contact) => contact.event_name)).size,
      avg,
      salesforceReady: contacts.filter((contact) => contact.email && contact.company && (contact.last_name || contact.name)).length
    };
  }, [contacts]);

  async function processCards() {
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Upload or capture at least one card image first.");
      return;
    }
    setProcessing(true);
    setProgress(0);
    const nextDrafts: ContactDraft[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const formData = new FormData();
      formData.append("eventName", eventName);
      formData.append("files", files[index]);
      const response = await fetch("/api/cards/process", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Failed to process ${files[index].name}`);
        break;
      }
      nextDrafts.push(...(data.drafts || []));
      setDrafts((current) => [...current, ...(data.drafts || [])]);
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }

    setProcessing(false);
    if (nextDrafts.length) setMessage(`Processed ${nextDrafts.length} card(s). Review and save them below.`);
  }

  async function saveDraft(index: number, draft: ContactDraft) {
    setError("");
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, status: draft.status === "New" ? "Reviewed" : draft.status })
    });
    const data = (await response.json()) as SaveContactResult & { error?: string };
    if (!response.ok) {
      setError(data.error || "Could not save contact.");
      return;
    }
    setMessage(data.action === "deduped" ? "Duplicate detected — existing contact was updated." : `Contact ${data.action}.`);
    setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index));
    await loadContacts();
    setTab("dashboard");
  }

  async function deleteContact(id: string) {
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    setSelectedIds((current) => current.filter((selected) => selected !== id));
    await loadContacts();
  }

  async function enrichContact(id: string) {
    setError("");
    const response = await fetch("/api/linkedin/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || "LinkedIn enrichment failed.");
    else setMessage(data.enrichment?.message || "LinkedIn enrichment stored.");
    await loadContacts();
  }

  async function pushSalesforce() {
    setError("");
    const ids = selectedIds.length ? selectedIds : filteredContacts.map((contact) => contact.id);
    const response = await fetch("/api/salesforce/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const data = (await response.json()) as { results?: SalesforcePushResult[]; error?: string };
    if (!response.ok) {
      setError(data.error || "Salesforce push failed.");
      return;
    }
    const ok = data.results?.filter((result) => result.ok).length || 0;
    const failed = data.results?.filter((result) => !result.ok).length || 0;
    setMessage(`Salesforce push complete: ${ok} succeeded, ${failed} failed.`);
    await loadContacts();
  }

  function updateDraft(index: number, patch: Partial<ContactDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="eyebrow">OCR → AI review → CRM</div>
          <h1>📇 Business Card Wizard</h1>
          <p className="subtitle">
            Capture trade-show cards, extract contacts with Google Vision + LLMs, review before save,
            dedupe, enrich LinkedIn profiles, export Excel/vCards/QR codes, and push real Salesforce Leads.
          </p>
        </div>
        <div className="card statusGrid" aria-label="Feature status">
          {Object.entries(features).map(([key, value]) => (
            <span className={`statusPill ${value ? "on" : ""}`} key={key}>
              {value ? "●" : "○"} {key}
            </span>
          ))}
        </div>
      </section>

      {!features.auth ? <div className="notice warn">Production warning: set APP_AUTH_PASSWORD to protect this wizard.</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <nav className="tabs" aria-label="Wizard sections">
        {[
          ["upload", "Upload + Review"],
          ["dashboard", "Dashboard"],
          ["salesforce", "Salesforce"],
          ["exports", "Exports"]
        ].map(([id, label]) => (
          <button className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as Tab)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "upload" ? (
        <section className="grid">
          <div className="card col6">
            <h2>1. Capture cards</h2>
            <div className="field">
              <label htmlFor="eventName">Event name</label>
              <input id="eventName" className="input" value={eventName} onChange={(event) => setEventName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="files">Upload or use phone camera</label>
              <input
                id="files"
                className="input"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
            </div>
            <div className="actions">
              <button className="btn" disabled={processing} onClick={processCards}>🚀 Process cards</button>
              <button className="btn secondary" disabled={processing} onClick={() => { setDrafts([]); setFiles([]); }}>Clear queue</button>
            </div>
            <p className="subtitle">Selected: {files.map((file) => file.name).join(", ") || "none"}</p>
            <div className="progress" aria-label="Processing progress"><span style={{ width: `${progress}%` }} /></div>
          </div>

          <div className="card col6">
            <h2>2. Review before saving</h2>
            <p className="subtitle">Every OCR/LLM result stays editable until you approve it.</p>
            {drafts.length === 0 ? <div className="notice">No draft contacts yet.</div> : null}
            {drafts.map((draft, index) => (
              <article className="reviewCard" key={`${draft.file_name}-${index}`}>
                <div className="actions" style={{ justifyContent: "space-between" }}>
                  <strong>{draft.file_name || `Draft ${index + 1}`}</strong>
                  <span className={confidenceClass(draft.confidence)}>{draft.confidence}% confidence</span>
                </div>
                {draft.warnings.length ? <div className="notice warn">{draft.warnings.join(" ")}</div> : null}
                <div className="grid">
                  <div className="field col6"><label>Name</label><input className="input" value={draft.name} onChange={(event) => updateDraft(index, { name: event.target.value })} /></div>
                  <div className="field col6"><label>Company</label><input className="input" value={draft.company} onChange={(event) => updateDraft(index, { company: event.target.value })} /></div>
                  <div className="field col6"><label>Title</label><input className="input" value={draft.title} onChange={(event) => updateDraft(index, { title: event.target.value })} /></div>
                  <div className="field col6"><label>Email</label><input className="input" value={draft.email} onChange={(event) => updateDraft(index, { email: event.target.value })} /></div>
                  <div className="field col6"><label>Phone</label><input className="input" value={draft.phone} onChange={(event) => updateDraft(index, { phone: event.target.value })} /></div>
                  <div className="field col6"><label>Mobile</label><input className="input" value={draft.mobile} onChange={(event) => updateDraft(index, { mobile: event.target.value })} /></div>
                  <div className="field col6"><label>LinkedIn</label><input className="input" value={draft.linkedin_url} onChange={(event) => updateDraft(index, { linkedin_url: event.target.value })} /></div>
                  <div className="field col6"><label>Tags</label><input className="input" value={tagsToText(draft.tags)} onChange={(event) => updateDraft(index, { tags: textToTags(event.target.value) })} /></div>
                  <div className="field col6"><label>Status</label><select className="input" value={draft.status} onChange={(event) => updateDraft(index, { status: event.target.value as ContactDraft["status"] })}><option>New</option><option>Reviewed</option><option>Qualified</option><option>Follow-up</option><option>Rejected</option></select></div>
                  <div className="field col6"><label>Follow-up date</label><input className="input" type="date" value={draft.follow_up_date || ""} onChange={(event) => updateDraft(index, { follow_up_date: event.target.value || null })} /></div>
                  <div className="field col12"><label>Notes</label><textarea value={draft.notes} onChange={(event) => updateDraft(index, { notes: event.target.value })} /></div>
                </div>
                <details><summary>Raw OCR text</summary><pre className="rawText">{draft.raw_text}</pre></details>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={() => saveDraft(index, draft)}>✅ Save reviewed contact</button>
                  <button className="btn danger" onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}>Discard</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "dashboard" ? (
        <section className="grid">
          <div className="metric col4"><strong>{metrics.contacts}</strong><span>Contacts</span></div>
          <div className="metric col4"><strong>{metrics.events}</strong><span>Events</span></div>
          <div className="metric col4"><strong>{metrics.avg}%</strong><span>Average confidence</span></div>
          <div className="card col12">
            <div className="actions">
              <select className="input" style={{ maxWidth: 220 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option><option>New</option><option>Reviewed</option><option>Qualified</option><option>Follow-up</option><option>Pushed to Salesforce</option><option>Rejected</option>
              </select>
              <input className="input" style={{ maxWidth: 260 }} placeholder="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} />
              <span className="statusPill on">{metrics.salesforceReady} Salesforce-ready</span>
            </div>
            <ContactTable contacts={filteredContacts} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onDelete={deleteContact} onEnrich={enrichContact} />
          </div>
        </section>
      ) : null}

      {tab === "salesforce" ? (
        <section className="card">
          <h2>Salesforce Lead push</h2>
          <p className="subtitle">Maps reviewed contacts to Salesforce Lead fields using OAuth refresh-token credentials.</p>
          {!features.salesforce ? <div className="notice warn">Set Salesforce OAuth env vars before pushing.</div> : null}
          <div className="actions">
            <button className="btn" onClick={pushSalesforce} disabled={!contacts.length}>☁️ Push selected / visible contacts</button>
            <span>{selectedIds.length ? `${selectedIds.length} selected` : `${filteredContacts.length} visible`}</span>
          </div>
          <ContactTable contacts={filteredContacts} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onDelete={deleteContact} onEnrich={enrichContact} compact />
        </section>
      ) : null}

      {tab === "exports" ? (
        <section className="card">
          <h2>Exports</h2>
          <div className="actions">
            <a className="btn" href="/api/exports/excel">⬇️ Excel data cube</a>
            <a className="btn secondary" href="/api/exports/vcard">📇 All vCards</a>
          </div>
          <p className="subtitle">Per-contact vCard and QR exports are available in the dashboard table.</p>
        </section>
      ) : null}
    </main>
  );
}

function ContactTable({
  contacts,
  selectedIds,
  setSelectedIds,
  onDelete,
  onEnrich,
  compact = false
}: {
  contacts: ContactRecord[];
  selectedIds: string[];
  setSelectedIds: (value: string[] | ((current: string[]) => string[])) => void;
  onDelete: (id: string) => void;
  onEnrich: (id: string) => void;
  compact?: boolean;
}) {
  if (!contacts.length) return <div className="notice">No contacts yet.</div>;

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]);
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr><th>Select</th><th>Name</th><th>Company</th><th>Email / phone</th><th>Status</th><th>Tags</th><th>Confidence</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {contacts.map((contact) => (
            <tr key={contact.id}>
              <td><input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggle(contact.id)} /></td>
              <td><strong>{contact.name || `${contact.first_name} ${contact.last_name}`}</strong><br />{contact.title}</td>
              <td>{contact.company}<br />{contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank">LinkedIn</a> : null}</td>
              <td>{contact.email}<br />{contact.mobile || contact.phone}</td>
              <td>{contact.status}<br />{contact.salesforce_id ? <span className="badge">SF: {contact.salesforce_id}</span> : null}</td>
              <td>{contact.tags.map((tag) => <span className="badge" key={tag}>{tag}</span>)}</td>
              <td className={confidenceClass(contact.confidence)}>{contact.confidence}%</td>
              <td>
                <div className="actions">
                  <a className="btn ghost" href={`/api/exports/vcard?ids=${contact.id}`}>vCard</a>
                  <a className="btn ghost" href={`/api/exports/qr/${contact.id}`} target="_blank">QR</a>
                  {!compact && contact.linkedin_url ? <button className="btn ghost" onClick={() => onEnrich(contact.id)}>Enrich</button> : null}
                  {!compact ? <button className="btn danger" onClick={() => onDelete(contact.id)}>Delete</button> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
