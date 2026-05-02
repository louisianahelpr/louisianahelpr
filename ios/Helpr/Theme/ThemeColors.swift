import SwiftUI

// MARK: - Garden District Stone Color System
// "Trust lives in restraint" — Professional, neutral, high-end palette
// Matches web branding (Tailwind/CSS variables)

extension Color {
  
  // MARK: Core Neutrals
  
  /// Off-white linen background (#FAFAF8)
  static let helprBackground = Color(red: 0.98, green: 0.973, blue: 0.973)
  
  /// Warm charcoal text color (#2A2A28)
  static let helprForeground = Color(red: 0.165, green: 0.165, blue: 0.157)
  
  /// Warm cream surface (#F5F3F0)
  static let helprSurface = Color(red: 0.961, green: 0.953, blue: 0.941)
  
  /// Soft greige secondary (#EEEBE6)
  static let helprSecondary = Color(red: 0.933, green: 0.922, blue: 0.902)
  
  // MARK: Accent Colors
  
  /// Muted slate green (#7A8070) — Interactive elements only
  static let helprAccent = Color(red: 0.475, green: 0.502, blue: 0.439)
  
  /// Barely-there sage for borders (#D4D8D0)
  static let helprBorder = Color(red: 0.831, green: 0.847, blue: 0.816)
  
  // MARK: Semantic Colors
  
  /// Success state — muted sage (#9FA89E)
  static let helprSuccess = Color(red: 0.624, green: 0.659, blue: 0.620)
  
  /// Success foreground (white)
  static let helprSuccessForeground = Color.white
  
  /// Warning state — muted warm taupe (#A89070)
  static let helprWarning = Color(red: 0.659, green: 0.565, blue: 0.439)
  
  /// Warning foreground (white)
  static let helprWarningForeground = Color.white
  
  /// Error state — muted mauve (#8A6B6B)
  static let helprError = Color(red: 0.541, green: 0.420, blue: 0.420)
  
  /// Error foreground (white)
  static let helprErrorForeground = Color.white
  
  /// Info state — muted sage (same as accent, #7A8070)
  static let helprInfo = Color(red: 0.475, green: 0.502, blue: 0.439)
  
  /// Info foreground (white)
  static let helprInfoForeground = Color.white
  
  // MARK: Dark Mode Variants (Future Support)
  
  /// Dark mode background
  static let helprBackgroundDark = Color(red: 0.08, green: 0.08, blue: 0.08)
  
  /// Dark mode surface
  static let helprSurfaceDark = Color(red: 0.11, green: 0.11, blue: 0.11)
  
  /// Dark mode foreground (light grey)
  static let helprForegroundDark = Color(red: 0.93, green: 0.93, blue: 0.93)
  
  // MARK: Disabled / Muted States
  
  /// Disabled text color — warm grey (#878780)
  static let helprMuted = Color(red: 0.529, green: 0.522, blue: 0.502)
  
  /// Card background (same as surface)
  static let helprCard = Color(red: 0.961, green: 0.953, blue: 0.941)
}

// MARK: - Dynamic Color Resolver (Light/Dark Mode Aware)

struct HelprColors {
  static let background = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color.helprBackgroundDark) : UIColor(Color.helprBackground) })
  static let foreground = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color.helprForegroundDark) : UIColor(Color.helprForeground) })
  static let surface = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color.helprSurfaceDark) : UIColor(Color.helprSurface) })
  static let accent = Color.helprAccent
  static let success = Color.helprSuccess
  static let warning = Color.helprWarning
  static let error = Color.helprError
  static let info = Color.helprInfo
  static let muted = Color.helprMuted
  static let border = Color.helprBorder
}

// MARK: - Component-Specific Colors (Convenience)

extension Color {
  /// Primary button color (muted sage)
  static var primaryButton: Color { .helprAccent }
  
  /// Secondary button color (soft greige)
  static var secondaryButton: Color { .helprSecondary }
  
  /// Button text (white on colored buttons)
  static var buttonForeground: Color { .white }
  
  /// Card shadow (use in ZStack with .shadow modifier)
  static var cardShadow: Color { Color.black.opacity(0.03) }
}

// MARK: - Preset Styles (Ready-to-Use)

struct HelprButtonStyle: ButtonStyle {
  var isSecondary: Bool = false
  
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundColor(.white)
      .padding(.horizontal, 20)
      .padding(.vertical, 12)
      .background(isSecondary ? Color.secondaryButton : Color.primaryButton)
      .cornerRadius(14)
      .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
      .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
  }
}

extension ButtonStyle where Self == HelprButtonStyle {
  static var helprPrimary: HelprButtonStyle {
    HelprButtonStyle(isSecondary: false)
  }
  
  static var helprSecondary: HelprButtonStyle {
    HelprButtonStyle(isSecondary: true)
  }
}

// MARK: - Card Style

struct HelprCardStyle: ViewModifier {
  func body(content: Content) -> some View {
    content
      .background(Color.helprCard)
      .cornerRadius(14)
      .overlay(
        RoundedRectangle(cornerRadius: 14)
          .stroke(Color.helprBorder, lineWidth: 1)
      )
      .shadow(color: Color.black.opacity(0.03), radius: 4, x: 0, y: 2)
  }
}

extension View {
  func helprCard() -> some View {
    modifier(HelprCardStyle())
  }
}

// MARK: - Export for Preview / Testing

#if DEBUG
struct HelprColors_Preview: PreviewProvider {
  static var previews: some View {
    VStack(spacing: 20) {
      // Neutrals
      HStack(spacing: 12) {
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprBackground)
          .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray))
          .frame(height: 60)
          .overlay(Text("Background").font(.caption).foregroundColor(.black))
        
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprSurface)
          .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray))
          .frame(height: 60)
          .overlay(Text("Surface").font(.caption).foregroundColor(.black))
        
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprSecondary)
          .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray))
          .frame(height: 60)
          .overlay(Text("Secondary").font(.caption).foregroundColor(.black))
      }
      
      // Semantic Colors
      HStack(spacing: 12) {
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprSuccess)
          .frame(height: 60)
          .overlay(Text("Success").font(.caption).foregroundColor(.white))
        
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprWarning)
          .frame(height: 60)
          .overlay(Text("Warning").font(.caption).foregroundColor(.white))
        
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.helprError)
          .frame(height: 60)
          .overlay(Text("Error").font(.caption).foregroundColor(.white))
      }
      
      // Accent
      RoundedRectangle(cornerRadius: 8)
        .fill(Color.helprAccent)
        .frame(height: 60)
        .overlay(Text("Accent (Interactive)").font(.caption).foregroundColor(.white))
      
      // Buttons
      Button(action: {}) {
        Text("Primary Button")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.helprPrimary)
      
      Button(action: {}) {
        Text("Secondary Button")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.helprSecondary)
      
      Spacer()
    }
    .padding(20)
    .background(Color.helprBackground)
  }
}
#endif
