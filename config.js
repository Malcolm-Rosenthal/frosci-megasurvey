/*
 * Megasurvey configuration — the only file you should need to edit to
 * add/remove studies, change wording on the wrapper screens, or point at the
 * Google Sheet.
 */
window.MEGASURVEY_CONFIG = {
  title: 'Frontiers of Science Survey',
  version: '2026.09-dev',

  // Google Apps Script web-app URL (ends in /exec). Leave '' while developing:
  // the survey runs normally but nothing is sent anywhere.
  endpoint: '',

  // ---------------- wrapper screens ----------------
  // Landing page: kept short — students already discussed the survey in class.
  consentHtml: `
    <p>Your responses are anonymous: we do not collect your name or email, and results are
    reported only in aggregate for class projects.</p>
    <p>Some parts include audio, so please have sound on.</p>
    <p>Please complete the survey in one sitting, without looking things up, and don't discuss
    it with anyone who hasn't taken it yet.</p>`,

  // Checkboxes that must all be ticked before starting.
  consentChecks: [
    'I agree to take part.',
  ],

  // Shown between parts. {n} = parts done, {total} = total parts. Set to null to skip straight on.
  interstitialHtml: `<p><strong>Part {n} of {total} complete.</strong></p>
    <p class="sk-muted">The next part is unrelated to the one you just finished.</p>`,

  endHtml: `
    <p>Thank you! Your responses have been recorded.</p>
    <p class="sk-muted">Please don't share details of the survey with anyone who hasn't taken it yet.</p>`,

  // Show a completion code on the final screen (e.g. for participation credit).
  showCompletionCode: false,

  // ---------------- studies ----------------
  // id          unique, matches StudyKit.start({ id }) in the study's page
  // path        folder containing the study's index.html
  // conditions  the wrapper assigns one at random (omit if the study randomises internally)
  // slot        'random' (default) | 'first' | 'last' — where it goes in the order
  // active      false to leave it out without deleting it
  // after       id of another study this one must follow (e.g. a memory test after its viewing part)
  // minGap      with `after`: at least this many other parts in between (when there are enough parts)
  // conditionFrom  copy the condition assigned to that study
  // team        for our records only; never shown to participants
  studies: [
    { id: 'demo-framing', path: 'studies/demo-framing/', conditions: ['gain', 'loss'], team: 'Demo', active: false },
    { id: 'demo-wordlist', path: 'studies/demo-wordlist/', team: 'Demo', active: false },
    { id: 'hedgehog-1010', path: 'studies/hedgehog-1010/', conditions: ['casual', 'formal'], team: 'Hedgehog (Wed 10:10)' },
    { id: 'sandwich-1210-view', path: 'studies/sandwich-1210/view.html', conditions: ['video', 'text'], team: 'Sandwich (Wed 12:10)' },
    { id: 'sandwich-1210-test', path: 'studies/sandwich-1210/test.html', after: 'sandwich-1210-view', minGap: 3,
      conditionFrom: 'sandwich-1210-view', team: 'Sandwich (Wed 12:10)' },
    { id: 'electron-1010', path: 'studies/electron-1010/', conditions: ['serious', 'fun', 'brainrot'], team: 'Electron (Wed 10:10)' },
    { id: 'cactus-1210', path: 'studies/cactus-1210/', conditions: ['anonymous', 'identified'], team: 'Cactus (Wed 12:10)' },
    { id: 'sandwich-1010', path: 'studies/sandwich-1010/', team: 'Sandwich (Wed 10:10)' },
    { id: 'electron-1210', path: 'studies/electron-1210/', conditions: ['timed', 'untimed'], team: 'Electron (Wed 12:10)' },
    { id: 'asteroid-1210', path: 'studies/asteroid-1210/', conditions: ['pos_first', 'neg_first'], team: 'Asteroid (Wed 12:10)' },
    { id: 'asteroid-1010', path: 'studies/asteroid-1010/', conditions: ['5-2s', '5-30s', '10-2s', '10-30s'], team: 'Asteroid (Wed 10:10)' },
    { id: 'melon-1010', path: 'studies/melon-1010/', conditions: ['audio', 'text'], team: 'Melon (Wed 10:10)' },
    { id: 'melon-1210', path: 'studies/melon-1210/', team: 'Melon (Wed 12:10)' },
    { id: 'cactus-1010', path: 'studies/cactus-1010/', team: 'Cactus (Wed 10:10)' },
    { id: 'hedgehog-1210', path: 'studies/hedgehog-1210/', conditions: ['found_first', 'lost_first'], team: 'Hedgehog (Wed 12:10)' },
  ],
};
