// A reporter that runs beside node's own (package.json "test"): it prints nothing while the browser tests run. On a
// machine with no Chrome, Edge or Chromium they skip themselves, each with the reason NO_BROWSER, and this ends the run
// with one line that says how many did not run and how to get a browser.
// With XCORE_TEST_ALL=1 (CI on Linux, where Chrome and the server tools are both there) a test that skips for any
// reason fails the run, and each one is named with its reason: a test that never runs holds nothing.
export const NO_BROWSER = 'no Chrome, Edge or Chromium here';

/** The line for `skipped` browser tests that did not run, or '' when all ran. */
export const browserSkipsLine = skipped =>
  skipped
    ? `\n${skipped} browser test${skipped === 1 ? '' : 's'} did not run: ${NO_BROWSER}. To run ${skipped === 1 ? 'it' : 'them'}, install Google Chrome or Chromium (or set CHROME_PATH to one), or get Playwright's own: npx playwright-core install chromium\n`
    : '';

/** The lines for the tests that skipped where every test must run ([{name, skip}]), or '' when none did. */
export const allRanLine = skipped =>
  skipped.length
    ? `\nXCORE_TEST_ALL is set, and ${skipped.length} test${skipped.length === 1 ? '' : 's'} did not run:\n${skipped.map(s => `  ${s.name}: ${s.skip}`).join('\n')}\n`
    : '';

export default async function* browserSkips(events, { env = process.env, fail = () => (process.exitCode = 1) } = {}) {
  let browser = 0;
  const skipped = [];
  for await (const event of events) {
    if (event.type !== 'test:pass' || !event.data.skip) continue;
    if (event.data.skip === NO_BROWSER) browser++;
    skipped.push({ name: event.data.name, skip: event.data.skip === true ? 'skipped' : event.data.skip });
  }
  yield browserSkipsLine(browser);
  if (env.XCORE_TEST_ALL === '1' && skipped.length) {
    fail();
    yield allRanLine(skipped);
  }
}
