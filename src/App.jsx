
import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import "./App.css";

export default function App() {
  const [page, setPage] = useState("Dashboard");
  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    title: "",
    category: "Roads",
    location: "",
    description: "",
  });
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadComplaints() {
      const { data, error } = await supabase
        .from("complaints")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading complaints:", error.message);
        setMessage("Could not load complaints. Please check the database connection.");
        return;
      }

      const formattedComplaints = data.map((item) => ({
        id: item.complaint_code,
        title: item.title,
        category: item.category,
        location: item.location,
        description: item.description,
        status: item.status,
        date: item.created_at.slice(0, 10),
      }));

      setComplaints(formattedComplaints);
    }

    loadComplaints();
  }, []);

  function saveComplaints(updated) {
    setComplaints(updated);
  }

  function openReport() {
    setMessage("");
    setPage("Report an Issue");
  }

  async function submitComplaint(e) {
    e.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);
    setMessage("");

    const complaintCode =
      "JV-" + Date.now().toString().slice(-6);

    const { data, error } = await supabase
      .from("complaints")
      .insert([
        {
          complaint_code: complaintCode,
          title: form.title.trim(),
          category: form.category,
          location: form.location.trim(),
          description: form.description.trim(),
          status: "Pending",
        },
      ])
      .select()
      .single();

    setIsSubmitting(false);

    if (error) {
      console.error("Complaint submission failed:", error.message);
      setMessage("Submission failed: " + error.message);
      return;
    }

    const newComplaint = {
      id: data.complaint_code,
      title: data.title,
      category: data.category,
      location: data.location,
      description: data.description,
      status: data.status,
      date: data.created_at.slice(0, 10),
    };

    setComplaints((previous) => [
      newComplaint,
      ...previous,
    ]);

    setForm({
      title: "",
      category: "Roads",
      location: "",
      description: "",
    });

    setMessage("Your complaint has been submitted successfully!");
    setPage("My Complaints");
  }

  function updateStatus(id, status) {
    saveComplaints(
      complaints.map((c) => (c.id === id ? { ...c, status } : c))
    );
    setSelected((old) => old ? { ...old, status } : null);
  }

  const filtered = complaints.filter((c) =>
    `${c.id} ${c.title} ${c.category} ${c.location}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const pending = complaints.filter((c) => c.status === "Pending").length;
  const progress = complaints.filter((c) => c.status === "In Progress").length;
  const resolved = complaints.filter((c) => c.status === "Resolved").length;

  const navItems = [
    { name: "Dashboard", icon: "⌂" },
    { name: "Report an Issue", icon: "+" },
    { name: "My Complaints", icon: "▤" },
    { name: "Authority Panel", icon: "▣" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("Dashboard")}>
          <span className="brand-icon">J</span>
          <span>
            <strong>JanVoice</strong>
            <small>Your city. Your voice.</small>
          </span>
        </button>

        <p className="menu-label">MAIN MENU</p>

        <nav>
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${page === item.name ? "active" : ""}`}
              onClick={() => {
                setPage(item.name);
                setMessage("");
                setSelected(null);
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
              {item.name === "Report an Issue" && <span className="nav-plus">+</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">♡</span>
            <strong>Better cities start with us.</strong>
            <p>Your voice can make a difference in your community.</p>
            <button onClick={openReport}>Report a problem →</button>
          </div>
          <p className="sidebar-footer">JANVOICE © 2026</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Community / {page}</p>
            <h2>{page}</h2>
          </div>
          <div className="topbar-right">
            <span className="online-dot" />
            <span className="citizen-label">Citizen Portal</span>
            <div className="avatar">C</div>
          </div>
        </header>

        <div className="page-content">
          {message && <div className="success-message">✓ {message}</div>}

          {page === "Dashboard" && (
            <>
              <section className="welcome-banner">
                <div className="welcome-text">
                  <span className="eyebrow">CITIZEN ENGAGEMENT PORTAL</span>
                  <h1>Make your city<br />a better place.</h1>
                  <p>See a problem? Speak up. Report civic issues and help your community thrive.</p>
                  <button className="primary-btn" onClick={openReport}>
                    + Report an Issue <span>→</span>
                  </button>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="sun" />
                  <div className="art-building building-one"><span>▥</span></div>
                  <div className="art-building building-two"><span>▥</span></div>
                  <div className="art-building building-three"><span>▥</span></div>
                  <div className="art-tree">♣</div>
                  <div className="art-ground" />
                </div>
                <div className="banner-decoration">✳</div>
              </section>

              <div className="section-heading">
                <div>
                  <h3>Community overview</h3>
                  <p>Here's what's happening with civic issues.</p>
                </div>
                <span className="live-tag"><span /> LIVE OVERVIEW</span>
              </div>

              <section className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top"><span>Total complaints</span><span className="stat-icon green">▤</span></div>
                  <h2>{complaints.length}</h2>
                  <p className="stat-note">All reported issues</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Pending</span><span className="stat-icon orange">◷</span></div>
                  <h2>{pending}</h2>
                  <p className="stat-note">Awaiting attention</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>In progress</span><span className="stat-icon blue">↻</span></div>
                  <h2>{progress}</h2>
                  <p className="stat-note">Being addressed</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Resolved</span><span className="stat-icon green">✓</span></div>
                  <h2>{resolved}</h2>
                  <p className="stat-note">Successfully resolved</p>
                </div>
              </section>

              <section className="content-card">
                <div className="card-heading">
                  <div><h3>Recent complaints</h3><p>Track the latest reports in your community.</p></div>
                  <button className="text-btn" onClick={() => setPage("My Complaints")}>View all →</button>
                </div>
                <ComplaintTable complaints={complaints.slice(0, 4)} onSelect={setSelected} />
              </section>

              <div className="bottom-note">
                <span>♧</span>
                <p><strong>Every report matters.</strong> Together, we can build cleaner, safer and better-connected communities.</p>
                <button onClick={openReport}>Get involved →</button>
              </div>
            </>
          )}

          {page === "Report an Issue" && (
            <section className="content-card form-card">
              <div className="form-intro">
                <div className="form-icon">＋</div>
                <div><h3>Report a civic issue</h3><p>Provide the details below so the appropriate team can review your complaint.</p></div>
              </div>

              <form onSubmit={submitComplaint}>
                <label>Issue title <span>*</span>
                  <input required maxLength={100} placeholder="e.g. Garbage overflowing near my street" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>

                <div className="form-row">
                  <label>Issue category <span>*</span>
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      <option>Roads</option>
                      <option>Garbage</option>
                      <option>Water Supply</option>
                      <option>Electricity</option>
                      <option>Drainage</option>
                      <option>Public Safety</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label>Location <span>*</span>
                    <input required placeholder="Street, area or landmark" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  </label>
                </div>

                <label>Description <span>*</span>
                  <textarea required rows="5" maxLength={1000} placeholder="Explain the issue and how it affects the community..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>

                <div className="form-hint">Please provide accurate details to help with resolution.</div>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setPage("Dashboard")}>Cancel</button>
                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Submitting..." : "Submit complaint →"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {page === "My Complaints" && (
            <section className="content-card">
              <div className="card-heading">
                <div><h3>My complaints</h3><p>Search and track the issues recorded in this browser.</p></div>
                <button className="primary-btn small-btn" onClick={openReport}>+ New complaint</button>
              </div>
              <SearchBox search={search} setSearch={setSearch} />
              <ComplaintTable complaints={filtered} onSelect={setSelected} />
              {filtered.length === 0 && <p className="empty-state">No complaints found. Try a different search.</p>}
            </section>
          )}

          {page === "Authority Panel" && (
            <section className="content-card">
              <div className="card-heading">
                <div><h3>Authority panel</h3><p>Demo controls for reviewing and updating complaints.</p></div>
                <span className="demo-tag">DEMO MODE</span>
              </div>
              <SearchBox search={search} setSearch={setSearch} />
              <ComplaintTable complaints={filtered} onSelect={setSelected} showStatusControl updateStatus={updateStatus} />
              {filtered.length === 0 && <p className="empty-state">No complaints found.</p>}
              <p className="form-hint">This demonstration panel is not protected by staff authentication.</p>
            </section>
          )}
        </div>

        <footer className="main-footer">
          <span>Made for communities, with care. ♡</span>
          <span>JanVoice · Civic Issue Reporting</span>
        </footer>
      </main>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelected(null)}>×</button>
            <span className="eyebrow">COMPLAINT DETAILS</span>
            <h2>{selected.title}</h2>
            <p className="complaint-id">{selected.id}</p>
            <div className="detail-line"><span>Category</span><strong>{selected.category}</strong></div>
            <div className="detail-line"><span>Location</span><strong>{selected.location}</strong></div>
            <div className="detail-line"><span>Date reported</span><strong>{selected.date}</strong></div>
            <div className="detail-line"><span>Status</span><StatusBadge status={selected.status} /></div>
            <h4>Description</h4>
            <p className="detail-description">{selected.description}</p>
            <button className="secondary-btn full-btn" onClick={() => setSelected(null)}>Close details</button>
          </section>
        </div>
      )}
    </div>
  );
}

function SearchBox({ search, setSearch }) {
  return (
    <div className="search-box">
      <span>⌕</span>
      <input placeholder="Search complaints, categories or locations..." value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = status.toLowerCase().replace(" ", "-");
  return <span className={`status-badge ${cls}`}>{status}</span>;
}

function ComplaintTable({ complaints, onSelect, showStatusControl, updateStatus }) {
  if (complaints.length === 0) {
    return <p className="empty-state">No complaints yet. Report an issue to get started.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="complaint-table">
        <thead><tr><th>COMPLAINT</th><th>CATEGORY</th><th>LOCATION</th><th>STATUS</th><th>DATE</th></tr></thead>
        <tbody>
          {complaints.map((c) => (
            <tr key={c.id}>
              <td><button className="complaint-link" onClick={() => onSelect(c)}><strong>{c.title}</strong><small>{c.id}</small></button></td>
              <td><span className="category-cell">{c.category}</span></td>
              <td>{c.location}</td>
              <td>
                {showStatusControl ? (
                  <select className="status-select" value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)} aria-label={`Update ${c.id} status`}>
                    <option>Pending</option><option>In Progress</option><option>Resolved</option>
                  </select>
                ) : <StatusBadge status={c.status} />}
              </td>
              <td>{c.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
