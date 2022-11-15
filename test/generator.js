const test = require('tape')
const fs = require('fs/promises')
const path = require('path')
const grunt = require('grunt')
const config = require('../Gruntfile.js')
const Generator = require('../libs/generator.js')

config(grunt)

const generator = Generator.generator(grunt.config, {}, grunt.log, grunt.file)
const testDir = __dirname
const fixturesDir = path.join(testDir, 'fixtures')

// explicitly exit the process because we start a firebase
// connection that will keep us open forever
test.onFinish(process.exit)

test('render-page', async (t) => {
  try {
    await generator.renderPage({
      inFile: path.join(fixturesDir, 'page.input.swig'),
      outFile: path.join(fixturesDir, 'page.output.actual.html'),
      data: {
        data: {
          page: {
            content: '# hola mundo\n\nque tal',
          },
        },
        contentType: {
          page: {
            name: 'page',
            oneOff: true,
          }
        },
        settings: {
          general: {},
        },
      },
    })  
  } catch (error) {
    t.fail(error, 'failed to render page')
  }
  
  const actual = await fs.readFile(path.join(fixturesDir, 'page.output.actual.html'))
  const expected = await fs.readFile(path.join(fixturesDir, 'page.output.expected.html'))
  t.ok(actual.toString() === expected.toString(), 'successfully renderd page')

  t.end()
})
