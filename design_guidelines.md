# Design Guidelines for NOLA DEX React Conversion

## Critical Constraint
**100% preservation of existing HTML design** - Every visual element, color, animation, spacing, and interaction must remain identical to the provided HTML file.

## Design Approach
**Reference-Based (Existing Design Preservation)** - This is a conversion project, not a redesign. All design decisions have been made in the original HTML.

---

## Color Palette (Exact Values from Original)
- **Primary Accent**: `#b445ff` (Purple)
- **Secondary Accent**: `#7013ff` (Deep Purple)
- **Background**: Radial gradient from `#0c0014` (center) to `#1a002b` (edges)
- **Glass Effects**: `rgba(255,255,255,0.05)` and `rgba(255,255,255,0.03)`
- **CTA Yellow**: `#ffcf33`
- **Text**: White (#fff) with varying opacity levels
- **Suggestion Background**: `rgba(25,0,50,0.98)`
- **Chat Panel**: `rgba(0,0,0,0.35)` with `backdrop-filter: blur(14px)`

## Typography
- **Primary Font**: Arial, sans-serif
- **Heading (h2)**: 26px, weight 600, color `#e0b3ff`, text-shadow with purple glow
- **Body Text**: 14px standard, 12-13px for secondary info
- **Button Text**: 15px, weight 800

## Layout System & Spacing
- **Container Max Width**: 520px
- **Section Wrapper**: Centered with `margin-top: 20vh`, padding 28px desktop / 18px mobile
- **Card Padding**: 22px
- **Border Radius**: 25px cards, 12px buttons, 10px inputs, 8px small elements
- **Spacing Units**: Use 6px, 8px, 10px, 12px, 14px, 18px, 22px, 28px consistently
- **Logo Position**: Fixed at top center, 8vh from top (6vh mobile), 84px width (72px mobile)

## Component Specifications

### Main Swap Card
- Glassmorphic container with `backdrop-filter: blur(18px)`
- Border: 1px solid `rgba(255,255,255,0.08)`
- Box shadow: `0 0 25px rgba(180,0,255,0.3)`
- Entrance animation: 800ms card slide-up fade-in

### Token Input Rows
- "Thin bar" design with unified row layout
- Background: `rgba(255,255,255,0.03)`, padding 8px 10px
- **Token Icons**: 36x36px, **rounded rectangles** (border-radius: 8px) NOT circles
- Token chip badges positioned bottom-right with gradient purple background
- Price displays right-aligned below amount inputs (12px font, 0.65-0.85 opacity)

### Suggestion Dropdown
- Internal scroll only (max-height: 240px), no page scroll
- Background: `rgba(25,0,50,0.98)` with purple glow shadow
- Hover: Gradient purple overlay
- Items: 28px circular token images, symbol + name + price pill layout

### Buttons
- **Glassy Buttons**: `rgba(255,255,255,0.03)` background, blur(6px), weight 800
- **Swap Outside**: 46x46px, circular icon button with subtle glass effect
- **Quick CTA**: Yellow gradient (`#ffcf33` to `#f7b400`), dark text, weight 900
- **Connected State**: Purple gradient background
- Active state: translateY(1px) with shadow removal

### Chat Panel
- Fixed right side, slides in from -350px to 20px
- Width: 320px, Height: 60% viewport
- Toggle button: Bottom-right corner, purple (`#7A4988`) with glow shadow
- Message bubbles: `rgba(255,255,255,0.04)` background, 12px border-radius

## Animations (Preserve Exactly)
1. **Nebula Background**: 35s infinite alternate ease-in-out movement
2. **Floating Particles**: 4x3px purple dots with float animation
3. **Logo**: Combined 25s glow pulse + 45s 3D rotation (rotateY)
4. **Card Entrance**: 800ms slide-up fade-in on load
5. **Button Active States**: 120ms translateY and shadow removal

## Background Effects
- **Nebula Layer**: Fixed position radial gradient purple overlay with animated translation
- **Particle System**: Multiple absolute-positioned purple dots with staggered float animations
- Both at z-index -2 and -1 respectively

## Responsive Breakpoints
- **Mobile**: max-width 720px
  - Full width containers (100%)
  - Reduced padding (18px vs 28px)
  - Smaller logo (72px vs 84px)
  - Column-reverse layout for section wrapper
- **Enhanced Mobile Smoothness**: Support 320px-428px with dynamic viewport handling
- **Touch Targets**: Minimum 44px for mobile tap areas
- **Smooth Scrolling**: `-webkit-overflow-scrolling: touch` for iOS

## Reown AppKit Integration
- Replace top-right wallet connect button with AppKit component
- Maintain identical button styling (glassy with purple gradient when connected)
- Position: Fixed top-right, 18px from edges
- Connected state shows address chip next to button
- Full integration with swap logic and transaction handling

## Footer
- Fixed bottom center, 12px from bottom
- Color: `rgba(255,255,255,0.75)`, 13px font
- Links in purple-tinted color: `rgba(215,165,255,0.95)`

## Critical Implementation Notes
- Body overflow hidden (scroll only in suggestions/chat containers)
- No color changes - exact hex/rgba values required
- All animations maintain original timing and easing functions
- Toast notifications fixed bottom-right with glass effect
- Slippage dropdown positioned absolute with glass background
- All variables (RPC URLs, contract addresses, API keys, colors, sizes) move to .env file