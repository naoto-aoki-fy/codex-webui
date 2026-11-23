# Copy individual code blocks and quotes

## Setup

Open a disposable TestChat conversation with a reply containing the Markdown below. Show the same blocks in a completed plan card. Include a code block inside an ordered list and a quote inside a bullet list.

~~~markdown
```ts
  const label = "<sample>";

    console.log(label);
```

```
plain
  indented

last line
```

> **Notice** [the guide](https://example.com/guide)
>
> *Next* line with `inline code`.

1. Run the example
   ```sh
     printf 'first\n'

       printf 'second\n'
   ```

- Background
  > **Read** [the guide](https://example.com/guide)
  > before continuing.
~~~

## Steps and expected results

1. Click each block's **Copy** button and paste into a plain-text editor. Each paste contains only the clicked block. Code retains indentation, blank lines and trailing spaces. Quotes paste as displayed text, with blank lines and link labels. The first quote pastes as three lines with a blank second line, with `Notice the guide` first and `Next line with inline code.` last.
2. Focus a copy button using Tab and press Enter or Space. On a touch device, tap the button. Verify that **Copied** appears briefly after each successful copy. In both light and dark themes, check at desktop and mobile widths that the button remains at the top right and clears the code, quote text and links.
3. On another device on the same LAN, open the app using the host's LAN IP and port, for example `http://192.168.1.10:4173`. Confirm that `navigator.clipboard` is unavailable in the browser console, then tap **Copy** and paste into a local editor. Expect the same exact text and **Copied** feedback.
4. In a disposable browser tab, where the Clipboard API is available, run `navigator.clipboard.writeText = async () => { throw new Error('Test denial') }` in DevTools. Leave `document.execCommand` intact and confirm the fallback pastes the clicked block and shows **Copied**. Then override `document.execCommand = () => false` and retry. Expect **Copy failed** briefly, the previously copied value still on the clipboard, and the original block text still selectable. Repeat the failure override on the LAN URL.
5. Add a fenced code block with thousands of lines and a distinctive final line. Inspect the block element in DevTools and check that the final line occurs once in its HTML, inside the code element. After the page settles, clear the Network panel, then copy the block and paste it into the editor. Expect the entire block and zero requests from the copy action.

## Cleanup

Reload to remove DevTools overrides, restore the preferred theme, and remove the disposable conversation when finished.
