import { useEffect, useState } from 'react';
import { useBrokenImageReport } from 'broken-image-reporter/react';

/**
 * Starts on a slow endpoint, then swaps to a valid image 300ms later.
 * The browser aborts the in-flight request and fires `error` — but nothing
 * is actually broken, so the reporter should discard it.
 */
function AbortedOnRerender() {
  const [src, setSrc] = useState('/api/slow.png');
  useEffect(() => {
    const t = setTimeout(() => setSrc('/ok.png'), 300);
    return () => clearTimeout(t);
  }, []);
  return <img src={src} alt="aborted mid-flight" />;
}

/** Unmounts before the slow request finishes. Also not a real failure. */
function UnmountedBeforeLoad() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 300);
    return () => clearTimeout(t);
  }, []);
  return show ? <img src="/api/slow.png?unmount" alt="unmounted" /> : <span>unmounted</span>;
}

const CASES = [
  { label: '403 expired (same origin)', src: '/api/expired.png' },
  { label: '404 missing (same origin)', src: '/api/missing.png' },
  { label: '404 but HEAD says 405', src: '/api/head-405.png' },
  { label: 'cross-origin, no CORS', src: 'https://www.google.com/nope-xyz.png' },
  { label: 'unresolvable host', src: 'https://nonexistent.invalid/a.png' },
  { label: 'data: URL (ignored)', src: 'data:image/png;base64,bm90YXBuZw==' },
  { label: 'valid (not reported)', src: '/ok.png' },
];

export function App() {
  const { count, errors, clearErrors, toCsv } = useBrokenImageReport();

  return (
    <main>
      <h1>broken-image-reporter demo</h1>
      <p>
        Installed from npm. The reporter was started in <code>main.tsx</code>; none of the
        images below have an <code>onError</code> prop.
      </p>

      <div className="row">
        {CASES.map(c => (
          <div className="case" key={c.src}>
            <img src={c.src} alt={c.label} />
            <div>{c.label}</div>
          </div>
        ))}
        <div className="case">
          <AbortedOnRerender />
          <div>aborted on re-render</div>
        </div>
        <div className="case">
          <UnmountedBeforeLoad />
          <div>unmounted before load</div>
        </div>
      </div>

      <h2 data-testid="count">Reported: {count}</h2>
      <button onClick={clearErrors}>Clear</button>
      <button onClick={() => console.log(toCsv())}>Log CSV</button>

      <table>
        <thead>
          <tr>
            <th>url</th>
            <th>httpStatus</th>
            <th>selector</th>
            <th>alt</th>
          </tr>
        </thead>
        <tbody>
          {errors.map(e => (
            <tr key={e.id}>
              <td>{e.url}</td>
              <td>{e.httpStatus ?? 'null'}</td>
              <td><code>{e.selector ?? '—'}</code></td>
              <td>{e.alt ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
