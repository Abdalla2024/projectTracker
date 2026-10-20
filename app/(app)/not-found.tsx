import Link from "next/link";

// Shown for a project that doesn't exist AND for one the user may not see. The wording is
// deliberately identical for both, so the page never reveals whether a hidden project exists.
export default function NotFound() {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h1>Project not found</h1>
      <p className="muted">It may not exist, or you may not have access to it.</p>
      <p><Link className="btn" href="/">Back to your projects</Link></p>
    </div>
  );
}
