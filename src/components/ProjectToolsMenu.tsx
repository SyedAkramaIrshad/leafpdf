import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface ProjectToolsMenuProps {
  commentsCount: number
  savingProject: boolean
  onSaveProject: () => void
  onReview: () => void
  onPrivacy: () => void
  onOcr: () => void
  onCompare: () => void
  onMarks: () => void
  onHelp: () => void
}

interface ProjectToolItem {
  label: string
  description: string
  action: () => void
  disabled?: boolean
}

export function ProjectToolsMenu({
  commentsCount,
  savingProject,
  onSaveProject,
  onReview,
  onPrivacy,
  onOcr,
  onCompare,
  onMarks,
  onHelp,
}: ProjectToolsMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const items: ProjectToolItem[] = [
    {
      label: savingProject ? 'Saving project' : 'Save project',
      description: 'Keep every source and edit for later',
      action: onSaveProject,
      disabled: savingProject,
    },
    {
      label: commentsCount ? `Review comments (${commentsCount})` : 'Review comments',
      description: 'Add and import PDF comments',
      action: onReview,
    },
    { label: 'Privacy check', description: 'Inspect metadata before sharing', action: onPrivacy },
    { label: 'Recognize text (OCR)', description: 'Find text in scanned pages', action: onOcr },
    { label: 'Compare PDFs', description: 'Review page-level differences', action: onCompare },
    { label: 'Watermark & page numbers', description: 'Apply repeating document marks', action: onMarks },
    { label: 'Help & shortcuts', description: 'Finish, save, and keyboard guide', action: onHelp },
  ]

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % menuItems.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + menuItems.length) % menuItems.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = menuItems.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      queueMicrotask(() => triggerRef.current?.focus())
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    menuItems[next]?.focus()
  }

  return (
    <div className="project-tools-menu">
      <button
        ref={triggerRef}
        type="button"
        className="project-tools-trigger"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-controls="project-tools-menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">•••</span>
        <span className="project-tools-trigger-label" aria-hidden="true">More</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id="project-tools-menu"
          className="project-tools-popover"
          role="menu"
          aria-label="Project tools"
          onKeyDown={navigateMenu}
        >
          <span className="project-tools-heading" aria-hidden="true">PROJECT TOOLS</span>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              aria-label={item.label}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.action()
              }}
            >
              <strong aria-hidden="true">{item.label}</strong>
              <span aria-hidden="true">{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
