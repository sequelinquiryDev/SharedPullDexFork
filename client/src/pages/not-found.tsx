import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100dvh)',
        padding: '20px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '72px', margin: '0', color: '#b445ff' }}>404</h1>
      <p style={{ fontSize: '18px', opacity: 0.8, marginBottom: '24px' }}>
        Page not found
      </p>
      <Link
        href="/"
        className="glassy-btn"
        data-testid="link-back-home"
      >
        Back to NOLA
      </Link>
    </div>
  );
}
