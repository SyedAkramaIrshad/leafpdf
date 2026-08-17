import { useEffect, useRef, type RefObject } from 'react'

/**
 * Everything a modal Tab cycle can land on. The signature pad is a canvas that is
 * focusable only while drawing (`tabindex="0"`), hence the canvas selector. No
 * visibility filtering is needed: these dialogs unmount the controls of inactive
 * tab panels rather than hiding them with CSS, so everything matched is tabbable.
 */
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, canvas[tabindex]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'

interface ModalDialogOptions {
  /**
   * Called when Escape is pressed. Each dialog maps this to its *safest* action —
   * RecoveryDialog keeps the recovery record, DiscardChangesDialog continues
   * editing — so Escape never destroys anything.
   */
  onEscape: () => void
  /** Receives focus when the dialog mounts. */
  initialFocusRef: RefObject<HTMLElement | null>
}

/**
 * Shared behaviour for every LeafPDF modal: focus moves into the dialog on mount
 * and back to the opener on unmount, Tab cycles inside the dialog, and Escape
 * runs the caller's safe action.
 *
 * The component using this must render the returned ref on its `role="dialog"`
 * element with `aria-modal="true"`, and must be mounted only while open —
 * mounting is what arms the trap, so an always-mounted dialog that merely
 * renders null would steal focus while closed.
 */
export function useModalDialog<T extends HTMLElement>({ onEscape, initialFocusRef }: ModalDialogOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef.current?.focus()
    // Return focus to the opener so keyboard users are not dropped at page top.
    return () => opener?.focus()
    // Mount-only by design: the opener is whoever held focus at open time, and
    // re-running on ref identity churn would re-steal focus mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // The workbench's own Escape handling (deselect, reset tool) must not
        // also fire while a modal owns the keyboard.
        event.stopPropagation()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [onEscape])

  return dialogRef
}
