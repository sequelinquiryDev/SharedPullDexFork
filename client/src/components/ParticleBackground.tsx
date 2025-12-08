import { useEffect } from 'react';

export function ParticleBackground() {
  useEffect(() => {
    const particles: HTMLDivElement[] = [];
    
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.top = `${Math.random() * 100}%`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.width = `${Math.random() * 3 + 1}px`;
      p.style.height = `${Math.random() * 3 + 1}px`;
      p.style.animationDuration = `${Math.random() * 10 + 5}s`;
      document.body.appendChild(p);
      particles.push(p);
    }

    return () => {
      particles.forEach((p) => p.remove());
    };
  }, []);

  return null;
}
