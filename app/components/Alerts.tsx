export function Alerts({ error, saved }: { error?: string; saved?: string }) {
  return (
    <>
      {error ? <p className="alert error" role="alert">{error}</p> : null}
      {saved ? <p className="alert ok" role="status">Saved.</p> : null}
    </>
  );
}
