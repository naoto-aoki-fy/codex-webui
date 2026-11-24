# Mobile viewport during pinch-to-zoom

## Prerequisites

- Run the app and open a thread with a scrollable conversation and an enabled composer.
- Use a touch device with a virtual keyboard. Repeat in light and dark themes and, when available, in Safari on iOS and Chrome on Android.

## Steps and expected results

1. At default zoom with the keyboard dismissed, pinch out over the conversation, then pan vertically. The browser magnifies the page, including the composer. The conversation and composer keep their layout proportions as you pan, without jumping into the keyboard layout or opening a blank gap.
2. Pinch back to default zoom and tap the composer. It fits above the keyboard. Dismiss the keyboard and confirm that the conversation fills the available height again.
3. Zoom in again and rotate the device. The layout adapts to the new orientation without applying the zoomed viewport's height or pan offset. Return to portrait and default zoom, then verify that the composer still fits above the keyboard when opened.
4. On desktop, with the window wider than the mobile breakpoint, shorten the window and restore its height. The conversation and composer fit the new height without a keyboard layout shift.

## Cleanup

Dismiss the keyboard and return the device, zoom level, and theme to their original settings.
