const test = require('tape')
const pspawn = require('./pspawn.js')

test('download-data', async (t) => {
  try {
    const data = await pspawn('grunt', ['download-data', '--emitter'])  
    t.ok('download-data:success')
  } catch (stderr) {
    t.ifError(stderr)
  }
  t.end()
})

test('build-page', async (t) => {
  try {
    await pspawn('grunt', [
      'build-page',
      '--inFile=pages/index.html',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-page:success')
  } catch (error) {
    console.error(error)
    t.fail('build-page:failed')
  }
  t.end()
})

test('build-pages', async (t) => {
  try {
    await pspawn('grunt', [
      'build-pages',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-pages:success')
  } catch (error) {
    console.error(error)
    t.fail('build-pages:failed')
  }
  t.end()
})

test('build-template', async (t) => {
  try {
    await pspawn('grunt', [
      'build-template',
      '--inFile=templates/collections/individual.html',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-template:success')
  } catch (error) {
    console.error(error)
    t.fail('build-template:failed')
  }
  t.end()
})

test('build-templates', async (t) => {
  try {
    await pspawn('grunt', [
      'build-templates',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-templates:success')
  } catch (error) {
    console.error(error)
    t.fail('build-templates:failed')
  }
  t.end()
})

test('build-page-cms', async (t) => {
  try {
    await pspawn('grunt', [
      'build-page-cms',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-page-cms:success')
  } catch (error) {
    console.error(error)
    t.fail('build-page-cms:failed')
  }
  t.end()
})

test('build-static', async (t) => {
  try {
    await pspawn('grunt', [
      'build-static',
      '--data=./.build/data.json',
      '--emitter'
    ])
    t.ok('build-static:success')
  } catch (error) {
    console.error(error)
    t.fail('build-static:failed')
  }
  t.end()
})

test('build-styles', async (t) => {
  try {
    await pspawn('grunt', [
      'build-styles',
      '--emitter'
    ])
    t.ok('build-styles:success')
  } catch (error) {
    console.error(error)
    t.fail('build-styles:failed')
  }
  t.end()
})

test('build-scripts', async (t) => {
  try {
    await pspawn('grunt', [
      'build-scripts',
      '--emitter'
    ])
    t.ok('build-scripts:success')
  } catch (error) {
    console.error(error)
    t.fail('build-scripts:failed')
  }
  t.end()
})

test('build', async (t) => {
  try {
    await pspawn('grunt', [
      'build',
      '--emitter'
    ])
    t.ok('build:success')
  } catch (error) {
    console.error(error)
    t.fail('build:failed')
  }
  t.end()
})


test('build-order', async (t) => {
  try {
    await pspawn('grunt', ['build-order'])
    t.ok('build-order:success')
  } catch (error) {
    console.error(error)
    t.fail('build-order:failed')
  }
  t.end()
})
