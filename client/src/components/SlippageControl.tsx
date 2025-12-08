import { useState, useRef, useEffect } from 'react';
import { config } from '@/lib/config';

interface SlippageControlProps {
  value: number;
  onChange: (value: number) => void;
}

export function SlippageControl({ value, onChange }: SlippageControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (v: number) => {
    onChange(v);
    setIsOpen(false);
  };

  return (
    <div className="slippage-wrap" ref={wrapperRef}>
      <div
        className="slippage-display"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-testid="button-slippage-display"
      >
        <span data-testid="text-slippage-value">{value}%</span>
        <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
      </div>

      {isOpen && (
        <div
          className="slippage-list"
          role="listbox"
          style={{ display: 'block' }}
          data-testid="list-slippage-options"
        >
          {config.slippageOptions.map((option) => (
            <div
              key={option}
              className="slippage-item"
              onClick={() => handleSelect(option)}
              role="option"
              aria-selected={value === option}
              data-testid={`slippage-option-${option}`}
            >
              {option}%
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
