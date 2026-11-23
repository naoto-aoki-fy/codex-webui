const assert = require('node:assert/strict')
const { resolve } = require('node:path')

const goalObjective = 'Keep Goal available while writing\n' + 'Preserve each line of this long objective.\n'.repeat(60) + 'End of the objective.'

async function assertGoalSettingsLayout(dialog, theme, status) {
  const layout = await dialog.evaluate(el => {
    const box = selector => el.querySelector(selector).getBoundingClientRect()
    const center = rect => rect.top + rect.height / 2
    const header = box('header')
    const heading = box('h2')
    const close = box('.management-dialog-close')
    const form = box('form')
    const objective = box('textarea')
    const label = box('.thread-goal-status > span')
    const statusValue = el.querySelector('.composer-dropdown-value')
    const value = statusValue.getBoundingClientRect()
    const body = el.querySelector('.management-dialog-body')
    return {
      headingInsets: [heading.top - header.top, header.bottom - heading.bottom - 1],
      headerOffset: center(heading) - center(close),
      leftAligned: heading.left === objective.left && objective.left === form.left,
      rightAligned: close.right === objective.right && objective.right === form.right,
      objectiveBottomGap: box('.thread-goal-status').top - objective.bottom,
      rowGap: parseFloat(getComputedStyle(el.querySelector('form')).rowGap),
      spaceBelowActions: form.bottom - box('.thread-goal-actions').bottom,
      bodyOverflow: body.scrollHeight - body.clientHeight,
      statusLabel: el.querySelector('.thread-goal-status > span').textContent,
      statusValue: statusValue.textContent,
      statusFits: label.right <= value.left && Math.abs(center(label) - center(value)) <= 2
        && statusValue.scrollWidth === statusValue.clientWidth,
      background: getComputedStyle(el.querySelector('textarea')).backgroundColor,
    }
  })
  assert.deepEqual(layout.headingInsets, [8, 8])
  assert.equal(layout.headerOffset, 0)
  assert(layout.leftAligned && layout.rightAligned, 'the editor fills the body width and aligns with the header')
  assert.equal(layout.objectiveBottomGap, layout.rowGap)
  assert.equal(layout.spaceBelowActions, 0, 'the editor takes all the spare height')
  assert.equal(layout.bodyOverflow, 0, 'at this height only the textarea content overflows')
  assert.equal(layout.statusLabel, 'Status:')
  assert.equal(layout.statusValue, status)
  assert(layout.statusFits, 'the status label and full value fit on a single line')
  assert.equal(layout.background, theme === 'dark' ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)')
}

async function openGoalStatusMenu(dialog, viewportTop = 0) {
  const trigger = dialog.locator('.composer-dropdown-trigger')
  await trigger.click()
  const menu = dialog.getByRole('listbox')
  await menu.waitFor()
  const menuBox = await dialog.locator('.composer-dropdown-menu').boundingBox()
  const triggerBox = await trigger.boundingBox()
  assert(menuBox.y >= viewportTop && menuBox.y + menuBox.height <= triggerBox.y, 'the status menu fits above its trigger')
  return menu
}

async function captureGoalSettings(page, mode, { width }, theme) {
  const screenshot = resolve(`output/playwright/goal-settings-${mode}-${width}-${theme}.png`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path:screenshot })
  return screenshot
}

module.exports = { goalObjective, assertGoalSettingsLayout, openGoalStatusMenu, captureGoalSettings }
