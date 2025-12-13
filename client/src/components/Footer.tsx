export function Footer() {
  return (
    <div className="footer" data-testid="footer">
      <div>© 2025 NOLA — All rights reserved</div>
      <div>
        <a href="/terms" data-testid="link-terms">Terms & Privacy</a>
        {' • '}
        <a href="https://x.com/NOLA_CHAIN" target="_blank" rel="noopener noreferrer" data-testid="link-twitter">
          X
        </a>
        {' '}
        <a href="https://t.me/NOLA_community" target="_blank" rel="noopener noreferrer" data-testid="link-telegram">
          Telegram
        </a>
        {' '}
        <a href="/" data-testid="link-website">
          Website
        </a>
      </div>
    </div>
  );
}