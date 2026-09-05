interface SkipNavigationProps {
  hasItemProperties: boolean
}

export function SkipNavigation({ hasItemProperties }: SkipNavigationProps) {
  return (
    <nav className="skip-navigation" aria-label="Skip links">
      <a href="#pdf-document">Skip to PDF</a>
      {hasItemProperties && <a href="#item-properties">Skip to item properties</a>}
    </nav>
  )
}
