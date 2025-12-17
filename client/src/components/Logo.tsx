export function Logo() {
  return (
    <div className="logo-container">
      <div className="logo-3d-wrapper">
        {/* Dynamic Aura effects - replaces gold balls */}
        <div className="aura aura-primary"></div>
        <div className="aura aura-secondary"></div>
        <div className="aura aura-accent"></div>
        
        {/* 3D Logo layers */}
        <div className="logo-3d-layer layer-1">
          <img
            src="/logo-nola.png"
            alt="NOLA Logo"
            style={{
              width: '84px',
              height: '84px',
              objectFit: 'contain'
            }}
          />
        </div>
        <div className="logo-3d-layer layer-2">
          <img
            src="/logo-nola.png"
            alt="NOLA Logo"
            style={{
              width: '84px',
              height: '84px',
              objectFit: 'contain'
            }}
          />
        </div>
        <div className="logo-3d-layer layer-3">
          <img
            src="/logo-nola.png"
            alt="NOLA Logo"
            style={{
              width: '84px',
              height: '84px',
              objectFit: 'contain'
            }}
          />
        </div>
      </div>
    </div>
  );
}
