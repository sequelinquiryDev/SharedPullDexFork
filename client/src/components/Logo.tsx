export function Logo() {
  return (
    <div className="logo-container">
      <div className="logo-3d-wrapper">
        {/* Shimmer effects */}
        <div className="shimmer shimmer-1"></div>
        <div className="shimmer shimmer-2"></div>
        <div className="shimmer shimmer-3"></div>
        
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
