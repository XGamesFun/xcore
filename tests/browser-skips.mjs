// A reporter that runs beside node's own (package.json "test"): it prints nothing while the browser tests run. On a
// machine with no Chrome, Edge or Chromium they skip themselves, each with the reason NO_BROWSER, and this ends the run
// with one line that says how many did not run and how to get a browser.
export const NO_BROWSER = 'no Chrome, Edge or Chromium here';

/** The line for `skipped` browser tests that did not run, or '' when all ran. */
export const browserSkipsLine = skipped =>
  skipped
    ? `\n${skipped} browser test${skipped === 1 ? '' : 's'} did not run: ${NO_BROWSER}. To run ${skipped === 1 ? 'it' : 'them'}, install Google Chrome or Chromium (or set CHROME_PATH to one), or get Playwright's own: npx playwright-core install chromium\n`
    : '';

export default async function* browserSkips(events) {
  let skipped = 0;
  for await (const event of events) if (event.type === 'test:pass' && event.data.skip === NO_BROWSER) skipped++;
  yield browserSkipsLine(skipped);
}
