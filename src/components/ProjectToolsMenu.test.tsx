import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectToolsMenu } from './ProjectToolsMenu'

function menuProps(savingProject = false) {
  return {
    commentsCount: 0,
    savingProject,
    onSaveProject: vi.fn(),
    onReview: vi.fn(),
    onPrivacy: vi.fn(),
    onOcr: vi.fn(),
    onCompare: vi.fn(),
    onMarks: vi.fn(),
    onHelp: vi.fn(),
  }
}

describe('ProjectToolsMenu', () => {
  it('keeps Save project first in More and runs the same project action', async () => {
    const props = menuProps()
    render(<ProjectToolsMenu {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }))
    const save = screen.getByRole('menuitem', { name: 'Save project' })
    await waitFor(() => expect(save).toHaveFocus())
    expect(save).toHaveTextContent('Keep every source and edit for later')

    fireEvent.click(save)
    expect(props.onSaveProject).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu', { name: 'Project tools' })).not.toBeInTheDocument()
  })

  it('disables the project command while a project download is being built', () => {
    render(<ProjectToolsMenu {...menuProps(true)} />)

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }))
    expect(screen.getByRole('menuitem', { name: 'Saving project' })).toBeDisabled()
  })
})
