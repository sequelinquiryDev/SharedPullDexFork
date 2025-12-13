import { useState, useEffect, useRef } from 'react';

export function ToolsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [showText, setShowText] = useState(false);
  const iframeRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      const textInterval = setInterval(() => {
        setShowText(true);
        setTimeout(() => setShowText(false), 5000);
      }, 15000);

      return () => clearInterval(textInterval);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        iframeRef.current &&
        buttonRef.current &&
        !iframeRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleIframeClick = () => {
    window.open('https://nol.pages.dev/snap', '_blank');
  };

  return (
    <>
      <div
        ref={buttonRef}
        className="tools-button"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="button-tools"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>

        <div className={`tools-text ${showText ? 'show' : ''}`}>
          soon nol tools
        </div>
      </div>

      {isOpen && (
        <div className="tools-iframe-container" ref={iframeRef}>
          <iframe
            src="https://nol.pages.dev/snap"
            className="tools-iframe"
            title="NOLA Tools"
            onClick={handleIframeClick}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}
    </>
  );
}