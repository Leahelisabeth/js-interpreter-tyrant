#!/usr/bin/env node
const fetch = require('node-fetch');
const os = require('os');
const path = require('path');
const yargs = require('yargs');
const fs = require('fs');
const execSync = require('child_process').execSync;
const spawn = require('child_process').spawn;
const chalk = require('chalk');
const runner = require('../runner');
const globber = require('test262-harness/lib/globber.js');
const ProgressBar = require('progress');

const argv = yargs
  .usage(`Usage: $0 [options] [test file glob pattern]`)

  .alias('d', 'diff')
  .describe('d', 'diff against existing test results. Returns exit code 1 if there are changes.')
  .boolean('d')

  .alias('r', 'run')
  .describe('r', 'generate new test results')
  .boolean('r')

  .describe('splitInto', 'Only run 1/N tests')
  .nargs('splitInto', 1)

  .describe('splitIndex', 'Which 1/N tests to run')
  .nargs('splitIndex', 1)

  .alias('s', 'save')
  .describe('s', 'save the results')
  .boolean('s')

  .alias('t', 'threads')
  .describe('t', '# of threads to use')
  .nargs('t', 1)
  .default('t', os.cpus().length)

  .describe('progress', 'display a progress bar')

  .alias('v', 'verbose')
  .boolean('v')

  .describe('root', 'Root directory where test262 suite and test results are kept')
  .default('root', 'tyrant')

  .describe('compiledOut', 'Directory to dump compiled test files to')
  .nargs('compiledOut', 1)

  .describe('savedResults', 'Specify a results file to compare and/or save to')
  .nargs('savedResults', 1)

  .alias('i', 'input')
  .describe('i', 'Specify a results file')
  .nargs('i', 1)

  .describe('circleBuild', 'specify a circle build to download results from')
  .nargs('circleBuild', 1)

  .nargs('interpreter', 1)
  .describe('interpreter', 'path to interpreter module to use')

  .describe('hostPath', 'path to the js-interpreter run script')
  .nargs('hostPath', 1)

  .help('h')
  .alias('h', 'help')
  .argv;

argv.input = argv.input || path.resolve(argv.root, 'test-results-new.json')
argv.savedResults = argv.savedResults || path.resolve(argv.root, 'test-results.json')

const RESULTS_FILE = path.resolve(argv.input);
const VERBOSE_RESULTS_FILE = path.resolve(argv.root, 'test-results-new.verbose.json');
const TEST_GLOBS = argv._.length > 0 ? argv._ : [
  'test262/test/annexB/**/*.js',
  'test262/test/harness/**/*.js',
  'test262/test/intl402/**/*.js',
  'test262/test/language/**/*.js',
  'test262/test/built-ins/Array/**/*.js',
  'test262/test/built-ins/ArrayBuffer/**/*.js',
  'test262/test/built-ins/ArrayIteratorPrototype/**/*.js',
  'test262/test/built-ins/AsyncFunction/**/*.js',
  'test262/test/built-ins/Atomics/**/*.js',
  'test262/test/built-ins/Boolean/**/*.js',
  'test262/test/built-ins/DataView/**/*.js',
  'test262/test/built-ins/Date/**/*.js',
  'test262/test/built-ins/decodeURI/**/*.js',
  'test262/test/built-ins/decodeURIComponent/**/*.js',
  'test262/test/built-ins/encodeURI/**/*.js',
  'test262/test/built-ins/encodeURIComponent/**/*.js',
  'test262/test/built-ins/Error/**/*.js',
  'test262/test/built-ins/eval/**/*.js',
  'test262/test/built-ins/Function/**/*.js',
  'test262/test/built-ins/GeneratorFunction/**/*.js',
  'test262/test/built-ins/GeneratorPrototype/**/*.js',
  'test262/test/built-ins/global/**/*.js',
  'test262/test/built-ins/Infinity/**/*.js',
  'test262/test/built-ins/isFinite/**/*.js',
  'test262/test/built-ins/isNaN/**/*.js',
  'test262/test/built-ins/IteratorPrototype/**/*.js',
  'test262/test/built-ins/JSON/**/*.js',
  'test262/test/built-ins/Map/**/*.js',
  'test262/test/built-ins/MapIteratorPrototype/**/*.js',
  'test262/test/built-ins/Math/**/*.js',
  'test262/test/built-ins/NaN/**/*.js',
  'test262/test/built-ins/NativeErrors/**/*.js',
  'test262/test/built-ins/Number/**/*.js',
  'test262/test/built-ins/Object/**/*.js',
  'test262/test/built-ins/parseFloat/**/*.js',
  'test262/test/built-ins/parseInt/**/*.js',
  'test262/test/built-ins/Promise/**/*.js',
  'test262/test/built-ins/Proxy/**/*.js',
  'test262/test/built-ins/Reflect/**/*.js',
  'test262/test/built-ins/RegExp/**/*.js',
  'test262/test/built-ins/Set/**/*.js',
  'test262/test/built-ins/SetIteratorPrototype/**/*.js',
  'test262/test/built-ins/SharedArrayBuffer/**/*.js',
  'test262/test/built-ins/Simd/**/*.js',
  'test262/test/built-ins/String/**/*.js',
  'test262/test/built-ins/StringIteratorPrototype/**/*.js',
  'test262/test/built-ins/Symbol/**/*.js',
  'test262/test/built-ins/ThrowTypeError/**/*.js',
  'test262/test/built-ins/TypedArray/**/*.js',
  // this test file currently makes the interpreter explode.
  //  'test262/test/built-ins/TypedArrays/**/*.js',
  'test262/test/built-ins/undefined/**/*.js',
  'test262/test/built-ins/WeakMap/**/*.js',
  'test262/test/built-ins/WeakSet/**/*.js',
].map(t => path.resolve(argv.root, t));


function saveResults(results) {
  console.log('Saving results for future comparison...');
  results = results.map(test => ({
    file: test.file,
    attrs: test.attrs,
    result: test.result,
  }))
  results.sort((a,b) => a.file < b.file ? -1 : a.file === b.file ? 0 : 1);
  fs.writeFileSync(argv.savedResults, JSON.stringify(results, null, 2));
}

function runTests(outputFilePath, verboseOutputFilePath) {
  return new Promise(resolve => {
    globber(TEST_GLOBS).toArray().subscribe(paths => {

      let globs = TEST_GLOBS;
      if (argv.splitInto) {
        // split up the globs in circle according to which container we are running on
        paths = paths.sort().filter(
          (path, index) => index % parseInt(argv.splitInto) === parseInt(argv.splitIndex)
        );
        globs = paths;
      }
      console.log(`running around ${paths.length * 2} tests with ${argv.threads} threads...`);

      const bar = new ProgressBar(
        '[:bar] :current/:total :percent | :minutes left | R::regressed, F::fixed, N::new',
        {
          total: paths.length * 2, // each file gets run in strict and unstrict mode
          width: 50,
        });

      let count = 1;
      const outputFile = fs.openSync(outputFilePath, 'w');
      let verboseOutputFile;
      if (argv.verbose) {
        verboseOutputFile = fs.openSync(verboseOutputFilePath, 'w');
      }
      let startTime;
      runner.run({
        compiledFilesDir: argv.compiledOut && path.resolve(argv.compiledOut),
        threads: argv.threads,
        timeout: 60000,
        hostType: 'js-interpreter',
        hostPath: argv.hostPath || path.resolve(__dirname, '../../js-interpreter/bin/run.js'),
        hostArgs: argv.interpreter ? ['--interpreter', argv.interpreter] : undefined,
        test262Dir: path.resolve(argv.root, 'test262'),
        reporter: (results) => {
          results.on('start', function () {
            startTime = new Date().getTime();
            fs.appendFileSync(outputFile, '[\n');
            if (verboseOutputFile) {
              fs.appendFileSync(verboseOutputFile, '[\n');
            }
          });
          results.on('end', function () {
            fs.appendFileSync(outputFile, ']\n');
            fs.closeSync(outputFile);
            if (verboseOutputFile) {
              fs.appendFileSync(verboseOutputFile, ']\n');
              fs.closeSync(verboseOutputFile);
            }
            console.log(`\nfinished running ${count} tests`);
            resolve();
          });
          let numRegressed = 0;
          let numFixed = 0;
          let numNew = 0;
          results.on('test end', test => {
            test.file = fs.realpathSync(test.file).replace(path.resolve(argv.root, '..') + '/', '');
            const color = test.result.pass ? chalk.green : chalk.red;
            const description = getTestDescription(test);
            function write() {
              if (!argv.progress) {
                process.stdout.write(...arguments);
              }
            }
            if (argv.diff) {
              const testDiff = getTestDiff(test);
              if (testDiff.isRegression) {
                write('R');
                numRegressed++;
              } else if (testDiff.isFix) {
                write('F');
                numFixed++;
              } else if (testDiff.isNew) {
                write('N');
                numNew++;
              } else {
                write('.');
              }
            } else {
              write('.');
            }
            if (argv.verbose) {
              write(` ${count+1} ${chalk.bold(color(description))}\n`);
              write(`   ${chalk.gray(test.file)}\n`);
              write(`   ${chalk.gray(test.result.message)}\n`);
            } else if (count % 80 === 0) {
              write('\n');
            }
            if (count > 1) {
              fs.appendFileSync(outputFile, ',\n')
              if (verboseOutputFile) {
                fs.appendFileSync(verboseOutputFile, ',\n');
              }
            }

            fs.appendFileSync(
              outputFile,
              JSON.stringify({
                file: test.file,
                attrs: test.attrs,
                result: test.result,
              }, null, 2)+'\n'
            );
            if (verboseOutputFile) {
              fs.appendFileSync(verboseOutputFile, JSON.stringify(test, null, 2)+'\n');
            }

            count++;
            if (argv.progress) {
              let secondsRemaining = (new Date().getTime() - startTime)/bar.curr * (bar.total - bar.curr)/1000;
              let eta;
              if (secondsRemaining > 60) {
                eta = `${Math.floor(secondsRemaining/60)}m`;
              } else {
                eta = `${Math.floor(secondsRemaining)}s`;
              }
              bar.tick(
                // tick twice for tests that don't run in both strict and non-strict modes
                !test.attrs.flags.onlyStrict && !test.attrs.flags.noStrict && !test.attrs.flags.raw ? 1 : 2,
                {
                  regressed: numRegressed,
                  fixed: numFixed,
                  "new": numNew,
                  minutes: eta,
                }
              );
            }
          });
        },
        globs: globs
      });
    });
  });
}

function downloadCircleResults() {
  console.log("downloading test results from circle ci...");
  const VCS_TYPE = 'github';
  const USERNAME = 'code-dot-org';
  const PROJECT = 'JS-Interpreter';
  const REQUEST_PATH = `https://circleci.com/api/v1.1/project/${VCS_TYPE}/${USERNAME}/${PROJECT}/${argv.circleBuild}/artifacts`;

  return fetch(REQUEST_PATH)
    .then(res => res.json())
    .then(artifacts => artifacts
      .filter(a => a.pretty_path === '$CIRCLE_ARTIFACTS/test-results-new.json')
      .map(a => a.url))
    .then(resultFileUrls => {
      const bar = new ProgressBar(
        '[:bar] :current/:total',
        {
          curr: 0,
          total: resultFileUrls.length,
        });
      return Promise.all(resultFileUrls.map(url =>
        fetch(url).then(res => {
          bar.tick();
          return res.json();
        })
      ));
    })
    .then(results => {
      const allResults = results.reduce((acc, val) => acc.concat(val), []);
      fs.writeFileSync(
        argv.input,
        JSON.stringify(allResults, null, 2)
      );
    });
}

function readResultsFromFile(filename) {
  return require(path.resolve(filename));
}

function getKeyForTest(test) {
  return [test.file, test.attrs.description].join(' ');
}

function getResultsByKey(results) {
  const byKey = {}
  results.forEach(test => byKey[getKeyForTest(test)] = test);
  return byKey;
}

const TEST_TYPES = ['es5', 'es6', 'es', 'other'];

function getTestType(test) {
  return test.attrs.es5id ? 'es5' :
         test.attrs.es6id ? 'es6' :
         test.attrs.esid ? 'es' :
         'other';
}

function getTestDescription(test) {
  return (test.attrs.description || test.file).trim().replace('\n', ' ');
}

function printResultsSummary(results) {
  let total = {};
  let passed = {};
  let percent = {};

  results.forEach(test => {
    const type = getTestType(test);
    if (!total[type]) {
      total[type] = 0;
      passed[type] = 0;
    }
    total[type]++;
    if (test.result.pass) {
      passed[type]++;
    }
    percent[type] = Math.floor(passed[type] / total[type] * 100);
  });

  console.log('Results:');
  TEST_TYPES.forEach(type => {
    if (total[type]) {
      console.log(`  ${type}: ${passed[type]}/${total[type]} (${percent[type]}%) passed`);
    }
  });
}

function getTestDiff(newTest) {
  const oldTest = OLD_RESULTS_BY_KEY[getKeyForTest(newTest)];
  return {
    isRegression: oldTest && oldTest.result.pass && !newTest.result.pass,
    isFix: oldTest && !oldTest.result.pass && newTest.result.pass,
    isNew: !oldTest,
  };
}

function printAndCheckResultsDiff(results) {
  const testsThatDiffer = {regressions: [], fixes: [], other: [], "new": []};
  let numRegressions = {};
  let numFixes = {};
  let numNew = {};
  let total = {};
  results.forEach(newTest => {
    const type = getTestType(newTest);
    if (!total[type]) {
      total[type] = 0;
      numRegressions[type] = 0;
      numFixes[type] = 0;
      numNew[type] = 0;
    }
    total[type]++;
    const oldTest = OLD_RESULTS_BY_KEY[getKeyForTest(newTest)];
    let diffList = testsThatDiffer.other;
    const testDiff = getTestDiff(newTest);
    if (testDiff.isRegression) {
      numRegressions[getTestType(newTest)]++;
      diffList = testsThatDiffer.regressions;
    } else if (testDiff.isFix) {
      numFixes[getTestType(newTest)]++;
      diffList = testsThatDiffer.fixes;
    } else if (testDiff.isNew) {
      numNew[getTestType(newTest)]++;
      diffList = testsThatDiffer.new;
    }
    diffList.push({oldTest, newTest});
  });


  if (argv.verbose) {
    const printTest = (color, {oldTest, newTest}, index) => {
      console.log(color(chalk.bold(`  ${index}. ${getTestDescription(newTest)}`)));
      console.log(chalk.gray(`     ${newTest.file}`));
      oldTest && console.log(`     - ${oldTest.result.message}`);
      console.log(`     + ${newTest.result.message}`);
    }
    console.log('\nNew:')
    testsThatDiffer.new.forEach(printTest.bind(null, chalk.green));
    console.log('Fixes:')
    testsThatDiffer.fixes.forEach(printTest.bind(null, chalk.green));
    console.log('\nRegressions:')
    testsThatDiffer.regressions.forEach(printTest.bind(null, chalk.red));
  }
  console.log('New:');
  TEST_TYPES.forEach(type => {
    if (total[type]) {
      console.log(`  ${type}: ${numNew[type]}/${total[type]}`);
    }
  });
  console.log('Fixes:');
  TEST_TYPES.forEach(type => {
    if (total[type]) {
      console.log(`  ${type}: ${numFixes[type]}/${total[type]}`);
    }
  });
  console.log('Regressions:');
  TEST_TYPES.forEach(type => {
    if (total[type]) {
      console.log(`  ${type}: ${numRegressions[type]}/${total[type]}`);
    }
  });

  for (let i = 0; i < TEST_TYPES.length; i++) {
    const type = TEST_TYPES[i];
    if (numRegressions[type] || numFixes[type]) {
      return true;
    }
  }
  return false;
}


function processTestResults() {
  const results = readResultsFromFile(RESULTS_FILE);

  if (argv.save) {
    saveResults(results);
  }

  printResultsSummary(results);
  if (argv.diff) {
    if (printAndCheckResultsDiff(results)) {
      process.exit(1);
    }
  }
}

const OLD_RESULTS_BY_KEY = argv.diff ? getResultsByKey(
  readResultsFromFile(
    typeof argv.diff === 'string' ? argv.diff : argv.savedResults
  )
): {};

if (argv.run) {
  runTests(RESULTS_FILE, VERBOSE_RESULTS_FILE).then(processTestResults);
} else if (argv.circleBuild) {
  downloadCircleResults().then(processTestResults);
} else {
  processTestResults()
}
