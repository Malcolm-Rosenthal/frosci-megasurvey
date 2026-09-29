/*
 * Sandwich Team (Wed 12:10) — THE single source for the facts, the video script and the test questions.
 * view.html and test.html both read this file, so the list, the narration and the quiz always match.
 *
 * Every fact is confirmed by at least two of:
 *   W = Wikipedia, "Great Molasses Flood"
 *   H = History.com, "The Great Molasses Flood of 1919"
 *   N = New England Historical Society, "The Great Boston Molasses Disaster of 1919"
 * Deliberately left out (sources disagree): wave height (15 vs 25 ft), exact time, lawsuit length,
 * how long the smell lasted. Also left out by choice: deaths and injuries.
 */
window.MOLASSES = {
  // Seconds the fact list stays on screen. Set this to the final video's length.
  exposureSeconds: 50,
  videoFile: 'media/molasses-reel.mp4',

  facts: [
    { id: 'f01_year',     kind: 'number', text: 'The Great Molasses Flood happened on January 15, 1919.',                                       src: 'W H N' },
    { id: 'f02_place',    kind: 'fact',   text: 'It happened in the North End neighborhood of Boston.',                                        src: 'W H N' },
    { id: 'f03_weather',  kind: 'number', text: 'It was an unusually warm winter day, over 40°F.',                                              src: 'W H' },
    { id: 'f04_tank',     kind: 'number', text: 'A giant storage tank holding 2.3 million gallons of molasses burst open.',                     src: 'W H N' },
    { id: 'f05_purpose',  kind: 'fact',   text: 'The molasses was going to be made into alcohol for producing munitions.',                      src: 'W H N' },
    { id: 'f06_paint',    kind: 'fact',   text: 'The tank leaked so badly that the company had painted it brown to hide the leaks.',            src: 'W N' },
    { id: 'f07_speed',    kind: 'number', text: 'The wave of molasses rushed through the streets at 35 miles per hour.',                        src: 'W H N' },
    { id: 'f08_blame',    kind: 'fact',   text: 'The company blamed anarchists, claiming they had blown up the tank.',                          src: 'W N' },
    { id: 'f09_harbor',   kind: 'fact',   text: 'Boston Harbor stayed brown with molasses until that summer.',                                  src: 'W H N' },
    { id: 'f10_damages',  kind: 'number', text: 'The company was eventually made to pay $628,000 in damages.',                                  src: 'W H N' },
  ],

  // Narration for the reel. Same 10 facts, same order, nothing extra except the hook and sign-off
  // (which contain no testable information). ~120 words ≈ 45–50 s at reel pace.
  script: [
    '[HOOK] The Great Molasses Flood: the weirdest disaster you’ve never heard of.',
    'January 15, 1919.',
    'Boston’s North End.',
    'It’s an unusually warm winter day — over 40 degrees.',
    'Then a giant tank holding 2.3 million gallons of molasses bursts open.',
    'That molasses was supposed to become alcohol for making munitions.',
    'And the tank? It leaked so badly, the company painted it brown to hide the leaks.',
    'The wave of molasses rushed through the streets at 35 miles per hour.',
    'The company’s excuse? They blamed anarchists for blowing up the tank.',
    'Boston Harbor stayed brown with molasses until that summer.',
    'In the end, the company paid $628,000 in damages.',
    '[SIGN-OFF] Follow for more history they never taught you.',
  ],

  // One question per fact. Correct answer is always listed first here; options are shuffled on screen.
  questions: [
    { fact: 'f01_year',    prompt: 'In what year did the Great Molasses Flood happen?',
      options: ['1919', '1899', '1929', '1946'] },
    { fact: 'f02_place',   prompt: 'Where did it happen?',
      options: ['Boston’s North End', 'Brooklyn’s Red Hook', 'Baltimore’s Inner Harbor', 'Philadelphia’s Old City'] },
    { fact: 'f03_weather', prompt: 'What was the weather like that day?',
      options: ['Unusually warm for winter (over 40°F)', 'Bitterly cold (below 0°F)', 'A heavy snowstorm', 'A thunderstorm'] },
    { fact: 'f04_tank',    prompt: 'About how much molasses did the tank hold?',
      options: ['2.3 million gallons', '500,000 gallons', '8 million gallons', '15 million gallons'] },
    { fact: 'f05_purpose', prompt: 'What was the molasses going to be used for?',
      options: ['Making alcohol for munitions', 'Making candy for soldiers', 'Feeding farm animals', 'Sweetening soft drinks'] },
    { fact: 'f06_paint',   prompt: 'What had the company done about the tank’s leaks?',
      options: ['Painted it brown to hide them', 'Wrapped it in canvas', 'Built a second wall around it', 'Posted guards to keep people away'] },
    { fact: 'f07_speed',   prompt: 'About how fast did the wave of molasses move?',
      options: ['35 miles per hour', '5 miles per hour', '15 miles per hour', '60 miles per hour'] },
    { fact: 'f08_blame',   prompt: 'Who or what did the company blame for the tank bursting?',
      options: ['Anarchists', 'An earthquake', 'A rival company', 'A lightning strike'] },
    { fact: 'f09_harbor',  prompt: 'How long did Boston Harbor stay brown with molasses?',
      options: ['Until that summer', 'About a day', 'About a week', 'For several years'] },
    { fact: 'f10_damages', prompt: 'How much did the company end up paying in damages?',
      options: ['$628,000', '$62,800', '$6.28 million', '$62.8 million'] },
  ],
};
